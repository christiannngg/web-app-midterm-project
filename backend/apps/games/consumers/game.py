import json
import logging
from typing import Any

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from ..schemas import (
    CLOSE_KICKED,
    ClientAction,
    ProtocolError,
    ServerEvent,
    parse_client_message,
)
from ..services import gameplay, lobby, scoring, timer

logger = logging.getLogger(__name__)


def group_name(code: str) -> str:
    """One Redis group per game. Every event for a game goes to this group and nowhere else."""
    return f"game_{code}"


# player id -> how many of that player's sockets are in the lobby right now. A phone that loses
# signal opens a *new* socket while the server still thinks the old one is alive; counting stops
# the old one's late disconnect from marking a player who is back online as offline.
# Process-local, like the game timers: run a single Daphne worker.
_open_sockets: dict[int, int] = {}


def _int_field(payload: dict[str, Any], key: str) -> int:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ProtocolError("bad_request", f"{key} must be an integer.")
    return value


class GameConsumer(AsyncJsonWebsocketConsumer):
    """One socket per participant; all sockets for a game share the group `game_<code>`.

    Handshake: the browser connects to `ws/game/<code>/?token=...` with either the host's JWT
    or a player token from `POST /api/games/join/`. A bad handshake is accepted and then closed
    with an application code (4401/4403/4404/4410) — closing *before* accept would reach the
    browser as an opaque HTTP 403, and the UI couldn't tell "kicked" from "wrong code".

    Phase 3 handles the lobby (LOBBY_JOIN, HOST_KICK, HOST_LOCK, HOST_START).
    Phase 4 adds ANSWER_SUBMIT / HOST_NEXT. The question clock itself is not here: HOST_START
    hands the game to `services.timer`, which broadcasts QUESTION_PUSH / SCORE_SYNC / GAME_END
    into the same group.

    Phase 5: a socket that connects while the game is running (a reconnect) is sent the events it
    missed (`gameplay.restore_snapshot`), and re-arms the game's timer if the server lost it.
    """

    # Defaults so disconnect() is safe even when connect() bailed out early.
    code: str = ""
    group: str = ""
    role: str | None = None
    player_id: int | None = None
    in_group = False
    in_lobby = False  # the player has sent LOBBY_JOIN and is marked connected

    # ---- lifecycle ---------------------------------------------------------------------

    async def connect(self) -> None:
        self.code = self.scope["url_route"]["kwargs"]["code"]
        self.group = group_name(self.code)
        try:
            identity = await database_sync_to_async(lobby.resolve_identity)(
                self.code, self.scope.get("user"), self.scope.get("token")
            )
        except lobby.ConnectionRefused as refused:
            await self.accept()
            await self.close(code=refused.close_code, reason=refused.reason)
            return

        self.role = identity.role
        self.player_id = identity.player_id
        await self.channel_layer.group_add(self.group, self.channel_name)
        self.in_group = True
        await self.accept()
        await self._send_lobby_state_to_me()

        restore = await database_sync_to_async(gameplay.restore_snapshot)(
            self.code, self.player_id
        )
        for event, payload in restore.messages:
            await self.send_json({"type": event.value, "payload": payload})
        if restore.in_progress:
            # No-op while the game's timer is alive; after a restart this is what revives it.
            timer.start_runner(self.code, resume=True)

    async def disconnect(self, code: int) -> None:
        if self.in_group:
            await self.channel_layer.group_discard(self.group, self.channel_name)
        if self._release_socket():  # this was the player's last open socket
            assert self.player_id is not None
            await database_sync_to_async(lobby.set_connected)(self.player_id, False)
            await self._broadcast_lobby_state()
            # The last player we were waiting on may be the one who just left.
            runner = timer.get_runner(self.code)
            if runner is not None and runner.phase == "question":
                await self._broadcast_answer_progress()
                await self._close_early_if_all_answered(runner)

    # ---- incoming ----------------------------------------------------------------------

    async def receive(self, text_data=None, bytes_data=None, **kwargs) -> None:
        try:
            content = json.loads(text_data or "")
        except ValueError:
            await self._send_error("bad_request", "Messages must be valid JSON.")
            return
        await self.receive_json(content)

    async def receive_json(self, content: Any, **kwargs) -> None:
        handlers = {
            ClientAction.LOBBY_JOIN: self._on_lobby_join,
            ClientAction.HOST_KICK: self._on_host_kick,
            ClientAction.HOST_LOCK: self._on_host_lock,
            ClientAction.HOST_START: self._on_host_start,
            ClientAction.ANSWER_SUBMIT: self._on_answer_submit,
            ClientAction.HOST_NEXT: self._on_host_next,
            ClientAction.PING: self._on_ping,
        }
        try:
            action, payload = parse_client_message(content)
            await handlers[action](payload)
        except ProtocolError as err:
            await self._send_error(err.code, err.detail)
        except Exception:  # never let one bad message take the socket down
            logger.exception("Unhandled error in game %s (%s)", self.code, self.role)
            await self._send_error("server_error", "Something went wrong on our side.")

    # ---- handlers ----------------------------------------------------------------------

    async def _on_lobby_join(self, payload: dict[str, Any]) -> None:
        self._require_role("player")
        assert self.player_id is not None
        if not self.in_lobby:
            self.in_lobby = True
            _open_sockets[self.player_id] = _open_sockets.get(self.player_id, 0) + 1
        await database_sync_to_async(lobby.set_connected)(self.player_id, True)
        await self._broadcast_lobby_state()
        runner = timer.get_runner(self.code)
        if runner is not None and runner.phase == "question":
            await self._broadcast_answer_progress()  # a returning player's answer counts again

    async def _on_host_kick(self, payload: dict[str, Any]) -> None:
        self._require_role("host")
        player_id = _int_field(payload, "playerId")
        if not await database_sync_to_async(lobby.kick_player)(self.code, player_id):
            raise ProtocolError("not_found", "No such player in this game.")
        # Tell the kicked player's socket to close itself, then refresh everyone's roster.
        await self.channel_layer.group_send(
            self.group, {"type": "player.kicked", "player_id": player_id}
        )
        await self._broadcast_lobby_state()

    async def _on_host_lock(self, payload: dict[str, Any]) -> None:
        self._require_role("host")
        locked = payload.get("locked")
        if not isinstance(locked, bool):
            raise ProtocolError("bad_request", "locked must be true or false.")
        await database_sync_to_async(lobby.set_locked)(self.code, locked)
        await self._broadcast_lobby_state()

    async def _on_host_start(self, payload: dict[str, Any]) -> None:
        self._require_role("host")
        await database_sync_to_async(lobby.start_game)(self.code)
        await self._broadcast_lobby_state()  # everyone sees status = IN_PROGRESS
        timer.start_runner(self.code)  # pushes the first question

    async def _on_answer_submit(self, payload: dict[str, Any]) -> None:
        self._require_role("player")
        assert self.player_id is not None
        question_id = _int_field(payload, "questionId")
        choice_id = _int_field(payload, "choiceId")
        await database_sync_to_async(scoring.submit_answer)(
            player_id=self.player_id, question_id=question_id, choice_id=choice_id
        )
        answered, total = await self._broadcast_answer_progress()
        runner = timer.get_runner(self.code)
        if runner is not None and total > 0 and answered >= total:
            runner.finish_early()

    async def _on_host_next(self, payload: dict[str, Any]) -> None:
        self._require_role("host")
        runner = timer.get_runner(self.code)
        if runner is None:
            raise ProtocolError("invalid_state", "The game is not running.")
        runner.skip()

    async def _on_ping(self, payload: dict[str, Any]) -> None:
        # Heartbeat: lets the browser notice a half-dead connection (no close event ever fires
        # when the network just vanishes) and reconnect.
        await self.send_json({"type": ServerEvent.PONG.value, "payload": {}})

    # ---- group events (delivered to every socket in the group) -------------------------

    async def broadcast_event(self, event: dict[str, Any]) -> None:
        await self.send_json(event["message"])

    async def player_kicked(self, event: dict[str, Any]) -> None:
        if event["player_id"] == self.player_id:
            self._release_socket()  # the kick already marked them disconnected
            await self.close(code=CLOSE_KICKED, reason="The host removed you from this game.")

    # ---- helpers -----------------------------------------------------------------------

    def _release_socket(self) -> bool:
        """Forget this socket's place in the lobby. True if it was the player's last open one."""
        if not self.in_lobby or self.player_id is None:
            return False
        self.in_lobby = False
        left = _open_sockets.get(self.player_id, 1) - 1
        if left > 0:
            _open_sockets[self.player_id] = left
            return False
        _open_sockets.pop(self.player_id, None)
        return True

    def _require_role(self, role: str) -> None:
        if self.role != role:
            raise ProtocolError("permission_denied", f"Only the {role} can do that.")

    async def _broadcast_answer_progress(self) -> tuple[int, int]:
        answered, total = await database_sync_to_async(gameplay.answer_progress)(self.code)
        await self.channel_layer.group_send(
            self.group,
            {
                "type": "broadcast.event",
                "message": {
                    "type": ServerEvent.ANSWER_PROGRESS.value,
                    "payload": {"answered": answered, "total": total},
                },
            },
        )
        return answered, total

    async def _close_early_if_all_answered(self, runner: timer.GameRunner) -> None:
        answered, total = await database_sync_to_async(gameplay.answer_progress)(self.code)
        if total > 0 and answered >= total:
            runner.finish_early()

    async def _lobby_state_message(self) -> dict[str, Any]:
        payload = await database_sync_to_async(lobby.lobby_snapshot)(self.code)
        return {"type": ServerEvent.LOBBY_STATE.value, "payload": payload}

    async def _send_lobby_state_to_me(self) -> None:
        await self.send_json(await self._lobby_state_message())

    async def _broadcast_lobby_state(self) -> None:
        await self.channel_layer.group_send(
            self.group, {"type": "broadcast.event", "message": await self._lobby_state_message()}
        )

    async def _send_error(self, code: str, detail: str) -> None:
        await self.send_json(
            {"type": ServerEvent.ERROR.value, "payload": {"code": code, "detail": detail}}
        )
