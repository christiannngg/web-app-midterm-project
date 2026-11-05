"""Live game state persisted in Postgres.

GameSession : quiz FK->Quiz, host FK->User, code (unique 6-char join code),
              status (LOBBY|IN_PROGRESS|FINISHED), is_locked (host closed the lobby to new
              joins), current_question_index, question_started_at (set while a
              question is open, NULL between questions), question_closed_at (set while the
              results of a question show, NULL otherwise), started_at, ended_at
Player      : session FK->GameSession, user FK->User (null for guests), nickname, score,
              is_connected (socket open), is_kicked (banned by the host; the row is kept so
              the nickname and token stay claimed and cannot rejoin)
Answer      : player FK->Player, question FK->Question, choice FK->Choice, answered_at,
              is_correct, points_awarded; one answer per (player, question)

Atomic scoring: see services/scoring.py (transaction.atomic + select_for_update / F()).
"""
import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q

# No 0/O/1/I so codes are easy to read aloud. Still matches the [A-Z0-9]{6} WS route.
JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
JOIN_CODE_LENGTH = 6


def generate_join_code() -> str:
    """Random candidate code. Phase 3 retries on IntegrityError if it ever collides."""
    return "".join(secrets.choice(JOIN_CODE_ALPHABET) for _ in range(JOIN_CODE_LENGTH))


class GameSession(models.Model):
    class Status(models.TextChoices):
        LOBBY = "LOBBY", "Lobby"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        FINISHED = "FINISHED", "Finished"

    quiz = models.ForeignKey("quizzes.Quiz", on_delete=models.CASCADE, related_name="sessions")
    host = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="hosted_games"
    )
    code = models.CharField(max_length=JOIN_CODE_LENGTH, unique=True, default=generate_join_code)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.LOBBY)
    is_locked = models.BooleanField(
        default=False, help_text="Host closed the lobby: no new players can join."
    )
    current_question_index = models.PositiveSmallIntegerField(default=0)
    question_started_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the current question opened. NULL = no question is accepting answers.",
    )
    question_closed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the current question closed (its results are showing). "
        "NULL while a question is open or before the first one.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.code} ({self.status})"


class Player(models.Model):
    session = models.ForeignKey(GameSession, on_delete=models.CASCADE, related_name="players")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="game_entries",
        help_text="Null for guests who joined with a nickname only.",
    )
    nickname = models.CharField(max_length=30)
    score = models.PositiveIntegerField(default=0)
    is_connected = models.BooleanField(default=False)
    is_kicked = models.BooleanField(
        default=False, help_text="Banned by the host. Kept as a row so they cannot rejoin."
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-score", "joined_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["session", "nickname"], name="unique_nickname_per_session"
            ),
            models.UniqueConstraint(
                fields=["session", "user"],
                condition=Q(user__isnull=False),
                name="unique_user_per_session",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.nickname} @ {self.session.code}"


class Answer(models.Model):
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="answers")
    question = models.ForeignKey(
        "quizzes.Question", on_delete=models.CASCADE, related_name="answers"
    )
    choice = models.ForeignKey("quizzes.Choice", on_delete=models.CASCADE, related_name="answers")
    answered_at = models.DateTimeField(auto_now_add=True)
    is_correct = models.BooleanField(default=False)
    points_awarded = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["player", "question"], name="one_answer_per_player_question"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.player_id} -> q{self.question_id} ({'ok' if self.is_correct else 'x'})"
