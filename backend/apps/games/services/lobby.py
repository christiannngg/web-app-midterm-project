"""Lobby rules, in plain sync ORM code.

The REST views call these directly; the Channels consumer wraps them in
`database_sync_to_async`. Keeping the rules here (not in the consumer) means they are
testable without a socket and the consumer stays a thin message router.
"""
from dataclasses import dataclass
from typing import Any, Literal

from django.db import IntegrityError, transaction
from django.utils import timezone

from ..models import GameSession, Player
from ..schemas import (
    CLOSE_FORBIDDEN,
    CLOSE_KICKED,
    CLOSE_NOT_FOUND,
    CLOSE_UNAUTHORIZED,
    ProtocolError,
)
from ..tokens import read_player_token

CODE_ATTEMPTS = 5


def create_game(host, quiz) -> GameSession:
    """New lobby with a fresh join code. The code column is UNIQUE; on the (very unlikely)
    collision we draw another code instead of failing the request."""
    for _ in range(CODE_ATTEMPTS):
        try:
            with transaction.atomic():  # savepoint, so a collision doesn't poison the caller
                return GameSession.objects.create(quiz=quiz, host=host)
        except IntegrityError:
            continue
    raise RuntimeError("Could not allocate a unique join code.")


# ---- socket handshake ---------------------------------------------------------------------


@dataclass(frozen=True)
class Identity:
    role: Literal["host", "player"]
    player_id: int | None = None


class ConnectionRefused(Exception):
    """The handshake failed; `close_code` tells the browser why (see schemas.py)."""

    def __init__(self, close_code: int, reason: str) -> None:
        super().__init__(reason)
        self.close_code = close_code
        self.reason = reason


def resolve_identity(code: str, user, token: str | None) -> Identity:
    """Who is on the other end of this socket?

    * a valid JWT (`user` is set by the middleware) is only accepted from this game's host
    * anything else must carry a player token issued by the join endpoint for *this* code
    """
    game = GameSession.objects.filter(code=code).only("id", "host_id").first()
    if game is None:
        raise ConnectionRefused(CLOSE_NOT_FOUND, "Game not found.")

    if user is not None and user.is_authenticated:
        if game.host_id == user.pk:
            return Identity("host")
        raise ConnectionRefused(CLOSE_FORBIDDEN, "You are not the host of this game.")

    if not token:
        raise ConnectionRefused(CLOSE_UNAUTHORIZED, "Authentication required.")
    parsed = read_player_token(token)
    if parsed is None or parsed[1] != code:
        raise ConnectionRefused(CLOSE_UNAUTHORIZED, "Invalid or expired token.")
    player = Player.objects.filter(pk=parsed[0], session_id=game.pk).first()
    if player is None:
        raise ConnectionRefused(CLOSE_FORBIDDEN, "You are not in this game.")
    if player.is_kicked:
        raise ConnectionRefused(CLOSE_KICKED, "The host removed you from this game.")
    return Identity("player", player.pk)


# ---- lobby state --------------------------------------------------------------------------


def lobby_snapshot(code: str) -> dict[str, Any]:
    """The LOBBY_STATE payload. Kicked players are not listed."""
    game = GameSession.objects.only("status", "is_locked").get(code=code)
    rows = Player.objects.filter(session__code=code, is_kicked=False).values(
        "id", "nickname", "score", "is_connected"
    )
    return {
        "players": [
            {
                "id": r["id"],
                "nickname": r["nickname"],
                "score": r["score"],
                "connected": r["is_connected"],
            }
            for r in rows
        ],
        "status": game.status,
        "locked": game.is_locked,
    }


def set_connected(player_id: int, connected: bool) -> None:
    Player.objects.filter(pk=player_id, is_kicked=False).update(is_connected=connected)


# ---- host controls (the consumer has already checked the caller is the host) ---------------


def kick_player(code: str, player_id: int) -> bool:
    """Ban a player from this game. False if there is no such (not already kicked) player."""
    updated = Player.objects.filter(
        pk=player_id, session__code=code, is_kicked=False
    ).update(is_kicked=True, is_connected=False)
    return updated > 0


def set_locked(code: str, locked: bool) -> None:
    with transaction.atomic():
        game = GameSession.objects.select_for_update().get(code=code)
        if game.status != GameSession.Status.LOBBY:
            raise ProtocolError("invalid_state", "The game has already started.")
        game.is_locked = locked
        game.save(update_fields=["is_locked"])


def start_game(code: str) -> None:
    """LOBBY -> IN_PROGRESS. The row lock makes a double-clicked Start start the game once."""
    with transaction.atomic():
        game = GameSession.objects.select_for_update().get(code=code)
        if game.status != GameSession.Status.LOBBY:
            raise ProtocolError("invalid_state", "The game has already started.")
        if not game.players.filter(is_kicked=False, is_connected=True).exists():
            raise ProtocolError("not_enough_players", "Wait for at least one player to join.")
        game.status = GameSession.Status.IN_PROGRESS
        game.started_at = timezone.now()
        game.save(update_fields=["status", "started_at"])
