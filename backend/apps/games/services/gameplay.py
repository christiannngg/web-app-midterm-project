"""Game progression in plain sync ORM code (same pattern as services/lobby.py).

The timer (services/timer.py) calls these through `database_sync_to_async`, in order:
    open_question -> [players answer: services/scoring.py] -> close_question -> ... -> finish_game
"""
from dataclasses import dataclass, field
from typing import Any, Literal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.quizzes.models import Question

from ..models import Answer, GameSession, Player
from ..schemas import ProtocolError, ServerEvent
from .scoring import current_question


def _ms(moment) -> int:
    return int(moment.timestamp() * 1000)


def _question_payload(
    question: Question, index: int, total: int, *, started_ms: int, now_ms: int
) -> dict[str, Any]:
    """The QUESTION_PUSH payload. `is_correct` is never part of it: the answer must not leak."""
    return {
        "id": question.pk,
        "text": question.text,
        "choices": [{"id": c.pk, "text": c.text} for c in question.choices.all()],
        "timeLimitSeconds": question.time_limit_s,
        "startedAtMs": started_ms,
        "serverNowMs": now_ms,  # lets clients measure their clock offset from the server
        "index": index,
        "total": total,
    }


def _reveal_payload(game_id: int, question: Question | None) -> dict[str, Any]:
    """The SCORE_SYNC payload for a question that is over (also replayed on reconnect)."""
    correct_id = None
    awarded: list[dict[str, int]] = []
    if question is not None:
        correct_id = question.choices.filter(is_correct=True).values_list("pk", flat=True).first()
        awarded = [
            {"playerId": a["player_id"], "points": a["points_awarded"]}
            for a in Answer.objects.filter(
                question_id=question.pk, player__session_id=game_id
            ).values("player_id", "points_awarded")
        ]
    return {"leaderboard": leaderboard(game_id), "correctChoiceId": correct_id, "awarded": awarded}


def leaderboard(game_id: int) -> list[dict[str, Any]]:
    """Every non-kicked player, best score first (ties: whoever joined first)."""
    rows = Player.objects.filter(session_id=game_id, is_kicked=False).values(
        "id", "nickname", "score"
    )  # Player.Meta.ordering is ["-score", "joined_at"]
    return [{"id": r["id"], "nickname": r["nickname"], "score": r["score"]} for r in rows]


def open_question(code: str, index: int) -> dict[str, Any] | None:
    """Open question `index` and return its QUESTION_PUSH payload; None when the quiz is over.

    `is_correct` is never part of the payload: the answer must not reach the browsers.
    """
    with transaction.atomic():
        game = GameSession.objects.select_for_update().get(code=code)
        if game.status != GameSession.Status.IN_PROGRESS:
            raise ProtocolError("invalid_state", "The game is not in progress.")
        questions = list(
            Question.objects.filter(quiz_id=game.quiz_id)
            .order_by("order", "id")
            .prefetch_related("choices")
        )
        if index >= len(questions):
            return None
        question = questions[index]
        now = timezone.now()
        game.current_question_index = index
        game.question_started_at = now
        game.question_closed_at = None
        game.save(
            update_fields=["current_question_index", "question_started_at", "question_closed_at"]
        )

    return _question_payload(question, index, len(questions), started_ms=_ms(now), now_ms=_ms(now))


def close_question(code: str) -> dict[str, Any] | None:
    """Stop accepting answers and build the SCORE_SYNC payload. None if nothing was open."""
    with transaction.atomic():
        # This lock waits for any in-flight `submit_answer` (it holds the same row), so the
        # leaderboard below includes every answer that was accepted.
        game = GameSession.objects.select_for_update().get(code=code)
        if game.question_started_at is None:
            return None
        question = current_question(game)
        game.question_started_at = None
        game.question_closed_at = timezone.now()
        game.save(update_fields=["question_started_at", "question_closed_at"])
        return _reveal_payload(game.pk, question)


def finish_game(code: str) -> dict[str, Any]:
    """IN_PROGRESS -> FINISHED and the GAME_END payload."""
    with transaction.atomic():
        game = GameSession.objects.select_for_update().get(code=code)
        game.status = GameSession.Status.FINISHED
        game.ended_at = timezone.now()
        game.question_started_at = None
        game.question_closed_at = None
        game.save(
            update_fields=["status", "ended_at", "question_started_at", "question_closed_at"]
        )
        return {"leaderboard": leaderboard(game.pk)}


def answer_progress(code: str) -> tuple[int, int]:
    """(connected players who answered the open question, players currently connected).

    Both sides count only players whose socket is open: someone who answered and then lost
    signal must not make "everyone has answered" true while a connected player still hasn't.
    """
    game = GameSession.objects.only("id", "quiz_id", "current_question_index").get(code=code)
    question = current_question(game)
    if question is None:
        return 0, 0
    answered = Answer.objects.filter(
        question_id=question.pk,
        player__session_id=game.pk,
        player__is_kicked=False,
        player__is_connected=True,
    ).count()
    connected = Player.objects.filter(
        session_id=game.pk, is_kicked=False, is_connected=True
    ).count()
    return answered, connected


# ---- reconnect: rebuild what a fresh socket missed ----------------------------------------


@dataclass(frozen=True)
class Restore:
    """What a newly connected socket needs, in the order to send it."""

    in_progress: bool
    messages: list[tuple[ServerEvent, dict[str, Any]]] = field(default_factory=list)


def restore_snapshot(code: str, player_id: int | None) -> Restore:
    """Events that redraw the current screen for a socket that (re)connected mid-game.

    Sent after the LOBBY_STATE every socket gets. Replays the *same* events a client that never
    left would have seen, so the browser needs no special "restore" code path:

      question open     QUESTION_PUSH (original startedAtMs) [+ YOUR_ANSWER] + ANSWER_PROGRESS
      results showing   QUESTION_PUSH [+ YOUR_ANSWER] + SCORE_SYNC
      game over         GAME_END
      lobby / not yet   nothing (LOBBY_STATE already says it all)
    """
    game = GameSession.objects.get(code=code)
    if game.status == GameSession.Status.FINISHED:
        return Restore(False, [(ServerEvent.GAME_END, {"leaderboard": leaderboard(game.pk)})])
    if game.status != GameSession.Status.IN_PROGRESS:
        return Restore(False)
    if game.question_started_at is None and game.question_closed_at is None:
        return Restore(True)  # HOST_START happened, but the first question isn't open yet

    questions = list(
        Question.objects.filter(quiz_id=game.quiz_id).order_by("order", "id").prefetch_related(
            "choices"
        )
    )
    index = game.current_question_index
    if index >= len(questions):
        return Restore(True)
    question = questions[index]
    now_ms = _ms(timezone.now())

    if game.question_started_at is not None:
        started_ms = _ms(game.question_started_at)
    else:
        # The original start time isn't kept once a question closes. Any start that puts the
        # deadline in the past draws the same thing: an expired countdown above the reveal.
        started_ms = _ms(game.question_closed_at) - question.time_limit_s * 1000

    messages: list[tuple[ServerEvent, dict[str, Any]]] = [
        (
            ServerEvent.QUESTION_PUSH,
            _question_payload(
                question, index, len(questions), started_ms=started_ms, now_ms=now_ms
            ),
        )
    ]
    if player_id is not None:
        choice_id = (
            Answer.objects.filter(player_id=player_id, question_id=question.pk)
            .values_list("choice_id", flat=True)
            .first()
        )
        if choice_id is not None:
            messages.append(
                (ServerEvent.YOUR_ANSWER, {"questionId": question.pk, "choiceId": choice_id})
            )
    if game.question_started_at is not None:
        answered, total = answer_progress(code)
        messages.append((ServerEvent.ANSWER_PROGRESS, {"answered": answered, "total": total}))
    else:
        messages.append((ServerEvent.SCORE_SYNC, _reveal_payload(game.pk, question)))
    return Restore(True, messages)


# ---- restart: where was the game when its timer disappeared? --------------------------------


@dataclass(frozen=True)
class ResumePoint:
    index: int
    phase: Literal["start", "question", "reveal"]
    remaining: float  # seconds left of that phase (never negative)


def resume_point(code: str) -> ResumePoint | None:
    """Where an IN_PROGRESS game stood, read from the DB. None if it isn't in progress.

    Used when a game has no timer (the server restarted, or the timer crashed): the runner
    picks up the clock from here instead of the game freezing on whatever was on screen.
    """
    game = GameSession.objects.get(code=code)
    if game.status != GameSession.Status.IN_PROGRESS:
        return None
    now = timezone.now()
    index = game.current_question_index
    if game.question_started_at is not None:
        question = current_question(game)
        limit = question.time_limit_s if question is not None else 0
        left = limit - (now - game.question_started_at).total_seconds()
        return ResumePoint(index, "question", max(left, 0.0))
    if game.question_closed_at is not None:
        reveal = float(getattr(settings, "TRIVIA_REVEAL_SECONDS", 5.0))
        left = reveal - (now - game.question_closed_at).total_seconds()
        return ResumePoint(index, "reveal", max(left, 0.0))
    return ResumePoint(0, "start", 0.0)
