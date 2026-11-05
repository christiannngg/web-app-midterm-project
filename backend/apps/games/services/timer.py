"""Server-authoritative game clock (F9).

One `GameRunner` asyncio task per running game drives the whole round loop:

    open question -> broadcast QUESTION_PUSH -> wait for the time limit
      -> close question -> broadcast SCORE_SYNC -> wait REVEAL seconds -> next ... -> GAME_END

The server owns the clock; browsers only draw a countdown from `startedAtMs`. A question ends
early when every connected player has answered, or when the host sends HOST_NEXT (skip).

Limits worth knowing:
  * The runner lives in this process's event loop, so run a single Daphne worker. The tasks are
    kept in `_runners`, keyed by join code, so a second HOST_START cannot start a second timer.
  * If the server restarts mid-game the timer is gone. The first socket that reconnects calls
    `start_runner(code, resume=True)`, which re-arms it from the DB (`gameplay.resume_point`):
    an open question keeps the time it had left, a results pause finishes what is left of it.
    Time the server spent down counts against the question, so a long outage skips ahead.
"""
import asyncio
import logging
from typing import Any

from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from django.conf import settings

from ..schemas import ServerEvent
from . import gameplay

logger = logging.getLogger(__name__)

_runners: dict[str, "GameRunner"] = {}


def group_name(code: str) -> str:
    return f"game_{code}"


class GameRunner:
    def __init__(self, code: str) -> None:
        self.code = code
        # "idle" -> "question" -> "closing" -> "reveal" -> "question" ... -> "done"
        self.phase = "idle"
        self.task: asyncio.Task[None] | None = None
        self._wake = asyncio.Event()

    # ---- called from the consumer ------------------------------------------------------

    def finish_early(self) -> None:
        """Everyone has answered: end the current question now."""
        if self.phase == "question":
            self._wake.set()

    def skip(self) -> None:
        """Host's HOST_NEXT: end the question, or cut the results screen short."""
        if self.phase in ("question", "reveal"):
            self._wake.set()

    # ---- the round loop ----------------------------------------------------------------

    async def run(self, resume: bool = False) -> None:
        try:
            index = 0
            open_left: float | None = None  # seconds left on a question already open in the DB
            point = (
                await database_sync_to_async(gameplay.resume_point)(self.code) if resume else None
            )
            if point is not None and point.phase == "reveal":
                self.phase = "reveal"
                self._wake.clear()
                await self._wait(point.remaining)
                index = point.index + 1
            elif point is not None and point.phase == "question":
                index, open_left = point.index, point.remaining

            while True:
                if open_left is None:
                    question = await database_sync_to_async(gameplay.open_question)(
                        self.code, index
                    )
                    if question is None:
                        break
                    self.phase = "question"
                    self._wake.clear()
                    await self._broadcast(ServerEvent.QUESTION_PUSH, question)
                    wait_for = question["timeLimitSeconds"]
                else:
                    # Resumed mid-question: it is already open, and reconnecting sockets are
                    # sent it by the consumer, so there is nothing to broadcast.
                    self.phase = "question"
                    self._wake.clear()
                    wait_for, open_left = open_left, None
                await self._wait(wait_for)

                self.phase = "closing"  # answers are rejected from here on
                results = await database_sync_to_async(gameplay.close_question)(self.code)
                if results is not None:
                    await self._broadcast(ServerEvent.SCORE_SYNC, results)

                self.phase = "reveal"
                self._wake.clear()
                await self._wait(float(getattr(settings, "TRIVIA_REVEAL_SECONDS", 5.0)))
                index += 1

            final = await database_sync_to_async(gameplay.finish_game)(self.code)
            await self._broadcast(ServerEvent.GAME_END, final)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Game runner for %s crashed", self.code)
            await self._broadcast(
                ServerEvent.ERROR,
                {"code": "game_error", "detail": "The game hit a server error and stopped."},
            )
        finally:
            self.phase = "done"

    async def _wait(self, seconds: float) -> None:
        """Sleep for `seconds`, or until finish_early()/skip() wakes us."""
        try:
            await asyncio.wait_for(self._wake.wait(), timeout=seconds)
        except TimeoutError:
            pass

    async def _broadcast(self, event: ServerEvent, payload: dict[str, Any]) -> None:
        await get_channel_layer().group_send(
            group_name(self.code),
            {"type": "broadcast.event", "message": {"type": event.value, "payload": payload}},
        )


# ---- registry ---------------------------------------------------------------------------


def get_runner(code: str) -> GameRunner | None:
    runner = _runners.get(code)
    return runner if runner and runner.phase != "done" else None


def start_runner(code: str, resume: bool = False) -> bool:
    """Start the timer for a game. False if one is already running for this code.

    `resume=True` continues a game that is already IN_PROGRESS from where the DB says it was.
    The check and the registration happen with no `await` in between, so two sockets
    reconnecting at the same instant still produce a single timer.
    """
    if get_runner(code) is not None:
        return False
    runner = GameRunner(code)
    runner.task = asyncio.get_running_loop().create_task(
        runner.run(resume=resume), name=f"game-{code}"
    )
    _runners[code] = runner
    runner.task.add_done_callback(lambda _task: _forget(code, runner))
    return True


def _forget(code: str, runner: GameRunner) -> None:
    if _runners.get(code) is runner:
        del _runners[code]


async def shutdown() -> None:
    """Cancel every running timer (server shutdown, and test teardown)."""
    tasks = [r.task for r in _runners.values() if r.task is not None]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _runners.clear()
