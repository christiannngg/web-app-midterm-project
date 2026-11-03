"""Signed player tokens: how a player (guest or account) authenticates their WebSocket.

`POST /api/games/join/` creates the Player row and returns one of these. The browser passes it
as `?token=` when it opens `ws/game/<code>/`. It carries only the player id and the game code,
so it is worthless for any other game, and it is invalid once the Player row is gone.
Hosts do not use this: they connect with their normal JWT.
"""
from django.core import signing

from .models import Player

SALT = "games.player-token"
MAX_AGE_SECONDS = 12 * 60 * 60  # a game lobby never lives this long


def make_player_token(player: Player) -> str:
    return signing.dumps({"p": player.pk, "c": player.session.code}, salt=SALT)


def read_player_token(token: str) -> tuple[int, str] | None:
    """Return (player_id, game_code), or None if the token is forged, expired or malformed."""
    try:
        data = signing.loads(token, salt=SALT, max_age=MAX_AGE_SECONDS)
        return int(data["p"]), str(data["c"])
    except (signing.BadSignature, KeyError, TypeError, ValueError):
        return None
