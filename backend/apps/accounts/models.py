from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Custom user (must exist before the first migration).

    Roles drive role-based permission guards (see permissions.py).
    """

    class Role(models.TextChoices):
        HOST = "host", "Host"
        PLAYER = "player", "Player"

    role = models.CharField(max_length=10, choices=Role.choices, default=Role.PLAYER)

    @property
    def is_host(self) -> bool:
        return self.role == self.Role.HOST


class PlayerProfile(models.Model):
    """One-to-One extension of User: cosmetic choice + lifetime stats.

    Created automatically for every new user (see signals.py).
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    avatar = models.CharField(max_length=32, blank=True, help_text="Emoji or avatar key.")
    games_played = models.PositiveIntegerField(default=0)
    games_won = models.PositiveIntegerField(default=0)
    total_score = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Profile<{self.user.username}>"
