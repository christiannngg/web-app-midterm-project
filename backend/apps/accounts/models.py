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

    # TODO: One-to-One PlayerProfile (avatar, lifetime stats) -> rubric: One-to-One
