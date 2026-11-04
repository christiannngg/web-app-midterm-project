"""Atomic answer submission and scoring (F11 + F12).

Rules
  * one answer per (player, question): a pre-check for a friendly error, plus the
    `one_answer_per_player_question` unique constraint as the backstop
  * only the question that is open right now accepts answers, and only until the server's
    clock says time is up (plus a small grace for network latency)
  * correct answers score `points * (0.5 + 0.5 * fraction_of_time_left)`: 100% of the
    question's points for an instant answer, 50% for one at the buzzer. Wrong = 0.

Concurrency
  Everything runs in one `transaction.atomic()`. The player row is locked with
  `select_for_update`, so a double-click (two submits from the same player) is serialised and
  the second one sees the first one's Answer. The score is then bumped with `F("score") + n`,
  which is a single `UPDATE ... SET score = score + n` evaluated by Postgres: no value is ever
  read into Python and written back, so concurrent updates cannot overwrite each other.
  The game row is locked too (always player first, then game: one fixed order, no deadlock) so
  `gameplay.close_question` cannot interleave with an in-flight answer, which keeps the
  leaderboard it broadcasts consistent with the Answer rows.
"""
from datetime import datetime, timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from apps.quizzes.models import Choice, Question

from ..models import Answer, GameSession, Player
from ..schemas import ProtocolError

# The browser's countdown can hit zero a moment before the server's does; an answer sent at
# 0:00 on the client arrives a little later. This keeps those from being rejected.
ANSWER_GRACE = timedelta(milliseconds=750)

# Even the slowest accepted correct answer keeps this share of the question's points.
MIN_POINTS_SHARE = 0.5


def compute_points(base_points: int, time_limit_s: int, elapsed_s: float) -> int:
    """Speed-weighted points for a *correct* answer. `elapsed_s` is clamped to the time limit."""
    limit = max(time_limit_s, 1)
    time_left = min(max(1 - elapsed_s / limit, 0.0), 1.0)
    share = MIN_POINTS_SHARE + (1 - MIN_POINTS_SHARE) * time_left
    return round(base_points * share)


def current_question(game: GameSession) -> Question | None:
    """The question at `current_question_index`, or None if the quiz has fewer."""
    return (
        Question.objects.filter(quiz_id=game.quiz_id).order_by("order", "id")[
            game.current_question_index : game.current_question_index + 1
        ].first()
    )


@transaction.atomic
def submit_answer(
    *, player_id: int, question_id: int, choice_id: int, now: datetime | None = None
) -> Answer:
    """Record a player's answer and add its points to their score. Raises ProtocolError."""
    now = now or timezone.now()

    # `of=("self",)` locks only the player row (not whatever a join would pull in).
    player = Player.objects.select_for_update(of=("self",)).filter(pk=player_id).first()
    if player is None:
        raise ProtocolError("not_found", "You are not in this game.")
    if player.is_kicked:
        raise ProtocolError("permission_denied", "You were removed from this game.")

    game = GameSession.objects.select_for_update(no_key=True).get(pk=player.session_id)
    if game.status != GameSession.Status.IN_PROGRESS or game.question_started_at is None:
        raise ProtocolError("question_closed", "No question is accepting answers right now.")

    question = current_question(game)
    if question is None or question.pk != question_id:
        raise ProtocolError("question_closed", "That question is no longer open.")

    elapsed = now - game.question_started_at
    if elapsed > timedelta(seconds=question.time_limit_s) + ANSWER_GRACE:
        raise ProtocolError("too_late", "Time is up for this question.")

    choice = Choice.objects.filter(pk=choice_id, question_id=question.pk).first()
    if choice is None:
        raise ProtocolError("invalid_choice", "That choice does not belong to this question.")

    if Answer.objects.filter(player_id=player.pk, question_id=question.pk).exists():
        raise ProtocolError("already_answered", "You already answered this question.")

    points = (
        compute_points(question.points, question.time_limit_s, elapsed.total_seconds())
        if choice.is_correct
        else 0
    )
    try:
        with transaction.atomic():  # savepoint: a constraint hit must not abort the outer tx
            answer = Answer.objects.create(
                player=player,
                question=question,
                choice=choice,
                is_correct=choice.is_correct,
                points_awarded=points,
            )
    except IntegrityError:
        raise ProtocolError("already_answered", "You already answered this question.") from None

    if points:
        Player.objects.filter(pk=player.pk).update(score=F("score") + points)
    return answer
