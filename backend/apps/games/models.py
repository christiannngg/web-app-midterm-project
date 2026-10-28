"""Live game state persisted in Postgres.

GameSession : quiz FK->Quiz, host FK->User, code (unique 6-char join code),
              status (LOBBY|IN_PROGRESS|FINISHED), current_question_index, started_at, ended_at
Player      : session FK->GameSession, user FK->User (null for guests), nickname, score
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
    current_question_index = models.PositiveSmallIntegerField(default=0)
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
    is_connected = models.BooleanField(default=True)
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
