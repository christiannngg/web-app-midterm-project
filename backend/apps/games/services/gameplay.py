"""Game progression in plain sync ORM code (same pattern as services/lobby.py).

The timer (services/timer.py) calls these through `database_sync_to_async`, in order:
    open_question -> [players answer: services/scoring.py] -> close_question -> ... -> finish_game
"""
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.quizzes.models import Question

from ..models import Answer, GameSession, Player
from ..schemas import ProtocolError
from .scoring import current_question


def _ms(moment) -> int:
    return int(moment.timestamp() * 1000)


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
        game.save(update_fields=["current_question_index", "question_started_at"])

    return {
        "id": question.pk,
        "text": question.text,
        "choices": [{"id": c.pk, "text": c.text} for c in question.choices.all()],
        "timeLimitSeconds": question.time_limit_s,
        "startedAtMs": _ms(now),
        "serverNowMs": _ms(now),  # lets clients measure their clock offset from the server
        "index": index,
        "total": len(questions),
    }


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
        game.save(update_fields=["question_started_at"])

        correct_id = None
        awarded: list[dict[str, int]] = []
        if question is not None:
            correct_id = (
                question.choices.filter(is_correct=True).values_list("pk", flat=True).first()
            )
            awarded = [
                {"playerId": a["player_id"], "points": a["points_awarded"]}
                for a in Answer.objects.filter(question_id=question.pk).values(
                    "player_id", "points_awarded"
                )
            ]
        return {
            "leaderboard": leaderboard(game.pk),
            "correctChoiceId": correct_id,
            "awarded": awarded,
        }


def finish_game(code: str) -> dict[str, Any]:
    """IN_PROGRESS -> FINISHED and the GAME_END payload."""
    with transaction.atomic():
        game = GameSession.objects.select_for_update().get(code=code)
        game.status = GameSession.Status.FINISHED
        game.ended_at = timezone.now()
        game.question_started_at = None
        game.save(update_fields=["status", "ended_at", "question_started_at"])
        return {"leaderboard": leaderboard(game.pk)}


def answer_progress(code: str) -> tuple[int, int]:
    """(players who answered the open question, players currently connected)."""
    game = GameSession.objects.only("id", "quiz_id", "current_question_index").get(code=code)
    question = current_question(game)
    if question is None:
        return 0, 0
    answered = Answer.objects.filter(question_id=question.pk, player__session_id=game.pk).count()
    connected = Player.objects.filter(
        session_id=game.pk, is_kicked=False, is_connected=True
    ).count()
    return answered, connected
