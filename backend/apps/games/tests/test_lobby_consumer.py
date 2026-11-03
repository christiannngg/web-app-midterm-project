"""End-to-end lobby behaviour over real (in-memory) Channels sockets."""
import pytest
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User
from apps.games.middleware import JWTAuthMiddleware
from apps.games.models import GameSession, Player
from apps.games.routing import websocket_urlpatterns
from apps.games.tokens import make_player_token
from apps.quizzes.models import Quiz

pytestmark = pytest.mark.django_db(transaction=True)

application = JWTAuthMiddleware(URLRouter(websocket_urlpatterns))


# ---- helpers --------------------------------------------------------------------------------


def make_game(username: str) -> tuple[User, GameSession]:
    host = User.objects.create_user(username, password="pw-for-tests-123", role=User.Role.HOST)
    quiz = Quiz.objects.create(owner=host, title=f"{username}'s quiz", is_published=True)
    return host, GameSession.objects.create(quiz=quiz, host=host)


def make_player(game: GameSession, nickname: str) -> tuple[Player, str]:
    player = Player.objects.create(session=game, nickname=nickname)
    return player, make_player_token(player)


def jwt_for(user: User) -> str:
    return str(AccessToken.for_user(user))


async def open_socket(code: str, token: str | None = None) -> WebsocketCommunicator:
    query = f"?token={token}" if token else ""
    comm = WebsocketCommunicator(application, f"/ws/game/{code}/{query}")
    connected, _ = await comm.connect()
    assert connected
    return comm


async def expect_close(comm: WebsocketCommunicator) -> int:
    message = await comm.receive_output(timeout=2)
    assert message["type"] == "websocket.close"
    return message["code"]


async def lobby_state(comm: WebsocketCommunicator) -> dict:
    message = await comm.receive_json_from(timeout=2)
    assert message["type"] == "LOBBY_STATE", message
    return message["payload"]


async def error_code(comm: WebsocketCommunicator) -> str:
    message = await comm.receive_json_from(timeout=2)
    assert message["type"] == "ERROR", message
    return message["payload"]["code"]


async def send(comm: WebsocketCommunicator, type_: str, payload: dict | None = None) -> None:
    await comm.send_json_to({"type": type_, "payload": payload or {}})


def nicknames(state: dict) -> list[str]:
    return [p["nickname"] for p in state["players"]]


@pytest.fixture
def lobby():
    host, game = make_game("hannah")
    return {"host": host, "game": game, "host_token": jwt_for(host)}


# ---- handshake ------------------------------------------------------------------------------


async def test_no_token_is_rejected_4401(lobby):
    comm = await open_socket(lobby["game"].code)
    assert await expect_close(comm) == 4401


async def test_unknown_game_is_4404():
    comm = await open_socket("AAAAAA", "whatever")
    assert await expect_close(comm) == 4404


async def test_garbage_token_is_4401(lobby):
    comm = await open_socket(lobby["game"].code, "garbage")
    assert await expect_close(comm) == 4401


async def test_player_token_only_works_for_its_own_game(lobby):
    _, other_game = await database_sync_to_async(make_game)("olga")
    _, token = await database_sync_to_async(make_player)(other_game, "Ann")
    comm = await open_socket(lobby["game"].code, token)  # token is for olga's game
    assert await expect_close(comm) == 4401


async def test_another_hosts_jwt_is_forbidden(lobby):
    other_host, _ = await database_sync_to_async(make_game)("olga")
    comm = await open_socket(lobby["game"].code, jwt_for(other_host))
    assert await expect_close(comm) == 4403


async def test_host_gets_lobby_state_on_connect(lobby):
    comm = await open_socket(lobby["game"].code, lobby["host_token"])
    state = await lobby_state(comm)
    assert state == {"players": [], "status": "LOBBY", "locked": False}
    await comm.disconnect()


# ---- two windows, one lobby -----------------------------------------------------------------


async def test_host_and_players_see_each_other(lobby):
    game = lobby["game"]
    _, ann_token = await database_sync_to_async(make_player)(game, "Ann")

    host = await open_socket(game.code, lobby["host_token"])
    await lobby_state(host)

    ann = await open_socket(game.code, ann_token)
    await lobby_state(ann)  # initial state, Ann isn't "in" until LOBBY_JOIN
    await send(ann, "LOBBY_JOIN")
    assert nicknames(await lobby_state(host)) == ["Ann"]
    assert nicknames(await lobby_state(ann)) == ["Ann"]

    # Bob joins over REST: he is listed (offline) right away, online once his socket says so.
    _, bob_token = await database_sync_to_async(make_player)(game, "Bob")
    bob = await open_socket(game.code, bob_token)
    state = await lobby_state(bob)
    assert {p["nickname"]: p["connected"] for p in state["players"]} == {"Ann": True, "Bob": False}
    await send(bob, "LOBBY_JOIN")
    for comm in (host, ann, bob):
        state = await lobby_state(comm)
        assert sorted(nicknames(state)) == ["Ann", "Bob"]
        assert all(p["connected"] for p in state["players"])

    for comm in (host, ann, bob):
        await comm.disconnect()


async def test_closing_a_tab_marks_the_player_offline(lobby):
    game = lobby["game"]
    _, ann_token = await database_sync_to_async(make_player)(game, "Ann")
    host = await open_socket(game.code, lobby["host_token"])
    await lobby_state(host)
    ann = await open_socket(game.code, ann_token)
    await lobby_state(ann)
    await send(ann, "LOBBY_JOIN")
    await lobby_state(host)

    await ann.disconnect()
    state = await lobby_state(host)
    assert state["players"][0]["connected"] is False
    await host.disconnect()


# ---- isolation (F6) -------------------------------------------------------------------------


async def test_second_games_events_never_reach_the_first(lobby):
    game_a = lobby["game"]
    host_b, game_b = await database_sync_to_async(make_game)("olga")
    _, ann_token = await database_sync_to_async(make_player)(game_a, "Ann")
    _, zed_token = await database_sync_to_async(make_player)(game_b, "Zed")

    host_a = await open_socket(game_a.code, lobby["host_token"])
    host_b_sock = await open_socket(game_b.code, jwt_for(host_b))
    await lobby_state(host_a)
    await lobby_state(host_b_sock)

    # Activity in game A ...
    ann = await open_socket(game_a.code, ann_token)
    await lobby_state(ann)
    await send(ann, "LOBBY_JOIN")
    assert nicknames(await lobby_state(host_a)) == ["Ann"]
    assert nicknames(await lobby_state(ann)) == ["Ann"]
    # ... is invisible in game B.
    assert await host_b_sock.receive_nothing(timeout=0.3)

    # And the other way round.
    zed = await open_socket(game_b.code, zed_token)
    await lobby_state(zed)
    await send(zed, "LOBBY_JOIN")
    assert nicknames(await lobby_state(host_b_sock)) == ["Zed"]
    assert nicknames(await lobby_state(zed)) == ["Zed"]
    assert await host_a.receive_nothing(timeout=0.3)
    assert await ann.receive_nothing(timeout=0.3)

    for comm in (host_a, host_b_sock, ann, zed):
        await comm.disconnect()


# ---- host controls --------------------------------------------------------------------------


async def test_kick_bans_the_player(lobby):
    game = lobby["game"]
    ann_row, ann_token = await database_sync_to_async(make_player)(game, "Ann")
    host = await open_socket(game.code, lobby["host_token"])
    await lobby_state(host)
    ann = await open_socket(game.code, ann_token)
    await lobby_state(ann)
    await send(ann, "LOBBY_JOIN")
    await lobby_state(host)
    await lobby_state(ann)

    await send(host, "HOST_KICK", {"playerId": ann_row.pk})
    assert nicknames(await lobby_state(host)) == []  # roster no longer lists her
    assert await expect_close(ann) == 4410

    # Her token no longer gets back in.
    again = await open_socket(game.code, ann_token)
    assert await expect_close(again) == 4410
    await host.disconnect()


async def test_kick_unknown_player_is_an_error_not_a_crash(lobby):
    host = await open_socket(lobby["game"].code, lobby["host_token"])
    await lobby_state(host)
    await send(host, "HOST_KICK", {"playerId": 999999})
    assert await error_code(host) == "not_found"
    await send(host, "HOST_KICK", {"playerId": "nope"})
    assert await error_code(host) == "bad_request"
    await host.disconnect()


async def test_lock_and_unlock_are_broadcast(lobby):
    game = lobby["game"]
    _, ann_token = await database_sync_to_async(make_player)(game, "Ann")
    host = await open_socket(game.code, lobby["host_token"])
    await lobby_state(host)
    ann = await open_socket(game.code, ann_token)
    await lobby_state(ann)

    await send(host, "HOST_LOCK", {"locked": True})
    assert (await lobby_state(host))["locked"] is True
    assert (await lobby_state(ann))["locked"] is True
    await send(host, "HOST_LOCK", {"locked": False})
    assert (await lobby_state(host))["locked"] is False

    await send(host, "HOST_LOCK", {"locked": "yes"})
    assert await error_code(host) == "bad_request"
    for comm in (host, ann):
        await comm.disconnect()


async def test_only_the_host_may_use_host_actions(lobby):
    game = lobby["game"]
    ann_row, ann_token = await database_sync_to_async(make_player)(game, "Ann")
    ann = await open_socket(game.code, ann_token)
    await lobby_state(ann)
    await send(ann, "LOBBY_JOIN")
    await lobby_state(ann)

    for action, payload in [
        ("HOST_START", {}),
        ("HOST_LOCK", {"locked": True}),
        ("HOST_KICK", {"playerId": ann_row.pk}),
    ]:
        await send(ann, action, payload)
        assert await error_code(ann) == "permission_denied"

    fresh = await database_sync_to_async(GameSession.objects.get)(pk=game.pk)
    assert fresh.status == "LOBBY" and fresh.is_locked is False
    await ann.disconnect()


async def test_host_cannot_send_lobby_join(lobby):
    host = await open_socket(lobby["game"].code, lobby["host_token"])
    await lobby_state(host)
    await send(host, "LOBBY_JOIN")
    assert await error_code(host) == "permission_denied"
    await host.disconnect()


async def test_start_needs_a_connected_player_then_flips_status_once(lobby):
    game = lobby["game"]
    _, ann_token = await database_sync_to_async(make_player)(game, "Ann")
    host = await open_socket(game.code, lobby["host_token"])
    await lobby_state(host)

    await send(host, "HOST_START")
    assert await error_code(host) == "not_enough_players"

    ann = await open_socket(game.code, ann_token)
    await lobby_state(ann)
    await send(ann, "LOBBY_JOIN")
    await lobby_state(host)
    await lobby_state(ann)

    await send(host, "HOST_START")
    for comm in (host, ann):
        assert (await lobby_state(comm))["status"] == "IN_PROGRESS"
    fresh = await database_sync_to_async(GameSession.objects.get)(pk=game.pk)
    assert fresh.started_at is not None

    await send(host, "HOST_START")  # double click
    assert await error_code(host) == "invalid_state"
    await send(host, "HOST_LOCK", {"locked": True})  # lobby controls are over too
    assert await error_code(host) == "invalid_state"
    for comm in (host, ann):
        await comm.disconnect()


# ---- bad input ------------------------------------------------------------------------------


async def test_bad_messages_get_an_error_and_the_socket_survives(lobby):
    host = await open_socket(lobby["game"].code, lobby["host_token"])
    await lobby_state(host)

    await host.send_to(text_data="this is not json")
    assert await error_code(host) == "bad_request"
    await host.send_json_to(["a", "list"])
    assert await error_code(host) == "bad_request"
    await host.send_json_to({"type": "DANCE", "payload": {}})
    assert await error_code(host) == "unknown_action"
    await host.send_json_to({"type": "HOST_LOCK", "payload": "nope"})
    assert await error_code(host) == "bad_request"
    await send(host, "HOST_NEXT")  # real action, not built yet
    assert await error_code(host) == "not_implemented"

    await send(host, "HOST_LOCK", {"locked": True})  # still alive and well
    assert (await lobby_state(host))["locked"] is True
    await host.disconnect()
