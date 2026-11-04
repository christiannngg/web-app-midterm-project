"""Server-authoritative game clock (F9).

One `GameRunner` asyncio task per running game drives the whole round loop:

    open question -> broadcast QUESTION_PUSH -> wait for the time limit
      -> close question -> broadcast SCORE_SYNC -> wait REVEAL seconds -> next ... -> GAME_END

The server owns the clock; browsers only draw a countdown from `startedAtMs`. A question ends
early when every connected player has answered, or when the host sends HOST_NEXT (skip).

Limits worth knowing (revisit in Phase 5):
  * The runner lives in this process's event loop, so run a single Daphne worker. The tasks are
    kept in `_runners`, keyed by join code, so a second HOST_START cannot start a second timer.
  * If the server restarts mid-game the timer is gone; the DB still says which question was
    open, so reconnect/restore can re-arm it.
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

    async def run(self) -> None:
        try:
            index = 0
            while True:
                question = await database_sync_to_async(gameplay.open_question)(self.code, index)
                if question is None:
                    break
                self.phase = "question"
                self._wake.clear()
                await self._broadcast(ServerEvent.QUESTION_PUSH, question)
                await self._wait(question["timeLimitSeconds"])

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


def start_runner(code: str) -> bool:
    """Start the timer for a game. False if one is already running for this code."""
    if get_runner(code) is not None:
        return False
    runner = GameRunner(code)
    runner.task = asyncio.get_running_loop().create_task(runner.run(), name=f"game-{code}")
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
