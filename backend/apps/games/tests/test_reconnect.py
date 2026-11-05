"""Phase 5: a socket that connects mid-game is brought back to where the game is, and a game
whose timer vanished (server restart) keeps running."""
from datetime import timedelta

import pytest
from channels.db import database_sync_to_async
from django.utils import timezone

from apps.accounts.models import User
from apps.games.models import GameSession, Player
from apps.games.services import gameplay, timer
from apps.games.tokens import make_player_token
from apps.quizzes.models import Quiz

from .test_gameplay import add_questions, hang_up, lobby_of, receive_until
from .test_lobby_consumer import jwt_for, open_socket, send

pytestmark = pytest.mark.django_db(transaction=True)


async def receive_all(comm, count: int, timeout: float = 2) -> list[dict]:
    return [await comm.receive_json_from(timeout=timeout) for _ in range(count)]


@database_sync_to_async
def token_for(player_id: int) -> str:
    return make_player_token(Player.objects.select_related("session").get(pk=player_id))


async def reconnect(code: str, token: str):
    """Open a brand-new socket (the old one is gone) and read its LOBBY_STATE welcome."""
    comm = await open_socket(code, token)
    first = await comm.receive_json_from(timeout=2)
    assert first["type"] == "LOBBY_STATE"
    return comm


async def test_player_who_reconnects_mid_question_gets_the_same_question_and_their_answer():
    game, key, host, players, ids = await lobby_of(["Ann", "Bob"], questions=2)
    await send(host, "HOST_START")
    push = await receive_until(players["Ann"], "QUESTION_PUSH")
    await receive_until(players["Bob"], "QUESTION_PUSH")
    await receive_until(host, "QUESTION_PUSH")

    ann_choice = key[push["id"]]["wrong"]
    await send(players["Ann"], "ANSWER_SUBMIT", {"questionId": push["id"], "choiceId": ann_choice})
    await receive_until(players["Ann"], "ANSWER_PROGRESS")

    await players["Ann"].disconnect()  # her connection dies; she opens a new socket
    ann = await reconnect(game.code, await token_for(ids["Ann"]))

    restored = await receive_all(ann, 3)
    assert [m["type"] for m in restored] == ["QUESTION_PUSH", "YOUR_ANSWER", "ANSWER_PROGRESS"]
    again = restored[0]["payload"]
    assert again["id"] == push["id"] and again["index"] == 0
    assert again["startedAtMs"] == push["startedAtMs"]  # same clock, not a restarted countdown
    assert again["serverNowMs"] >= push["serverNowMs"]
    assert all(set(c) == {"id", "text"} for c in again["choices"])  # still no answer key
    assert restored[1]["payload"] == {"questionId": push["id"], "choiceId": ann_choice}

    # Once she rejoins the room her earlier answer counts again: 1 of 2 connected players.
    await send(ann, "LOBBY_JOIN")
    assert await receive_until(ann, "ANSWER_PROGRESS") == {"answered": 1, "total": 2}
    await hang_up(ann, host, players["Bob"])


async def test_answering_then_dropping_does_not_end_the_question_for_the_others():
    game, key, host, players, ids = await lobby_of(["Ann", "Bob"], questions=1)
    await send(host, "HOST_START")
    push = await receive_until(players["Ann"], "QUESTION_PUSH")
    await send(
        players["Ann"],
        "ANSWER_SUBMIT",
        {"questionId": push["id"], "choiceId": key[push["id"]]["right"]},
    )
    await receive_until(players["Bob"], "ANSWER_PROGRESS")

    await players["Ann"].disconnect()
    # Bob is the only one connected and hasn't answered: the question must still be open.
    assert await receive_until(players["Bob"], "ANSWER_PROGRESS") == {"answered": 0, "total": 1}
    assert await players["Bob"].receive_nothing(timeout=0.3)
    await send(
        players["Bob"],
        "ANSWER_SUBMIT",
        {"questionId": push["id"], "choiceId": key[push["id"]]["wrong"]},
    )
    await receive_until(players["Bob"], "SCORE_SYNC")  # now everyone connected has answered
    await hang_up(host, players["Bob"])


async def test_host_who_reconnects_while_results_show_gets_the_reveal(settings):
    settings.TRIVIA_REVEAL_SECONDS = 30  # the results stay up until HOST_NEXT
    game, key, host, players, ids = await lobby_of(["Ann"], questions=2)
    await send(host, "HOST_START")
    push = await receive_until(players["Ann"], "QUESTION_PUSH")
    await send(
        players["Ann"],
        "ANSWER_SUBMIT",
        {"questionId": push["id"], "choiceId": key[push["id"]]["right"]},
    )
    synced = await receive_until(players["Ann"], "SCORE_SYNC")

    await host.disconnect()
    new_host = await reconnect(game.code, jwt_for(game.host))
    restored = await receive_all(new_host, 2)
    assert [m["type"] for m in restored] == ["QUESTION_PUSH", "SCORE_SYNC"]
    assert restored[0]["payload"]["id"] == push["id"]
    assert restored[1]["payload"]["correctChoiceId"] == key[push["id"]]["right"]
    assert restored[1]["payload"]["leaderboard"] == synced["leaderboard"]

    await send(new_host, "HOST_NEXT")  # the reconnected host is fully in control again
    assert (await receive_until(new_host, "QUESTION_PUSH"))["index"] == 1
    await hang_up(new_host, players["Ann"])


async def test_socket_that_connects_after_the_game_ended_gets_game_end():
    game, key, host, players, ids = await lobby_of(["Ann"], questions=1)
    await send(host, "HOST_START")
    question = await receive_until(players["Ann"], "QUESTION_PUSH")
    await send(
        players["Ann"],
        "ANSWER_SUBMIT",
        {"questionId": question["id"], "choiceId": key[question["id"]]["right"]},
    )
    ended = await receive_until(players["Ann"], "GAME_END")
    await players["Ann"].disconnect()

    ann = await reconnect(game.code, await token_for(ids["Ann"]))
    assert await ann.receive_json_from(timeout=2) == {"type": "GAME_END", "payload": ended}
    await hang_up(ann, host)


async def test_lobby_reconnect_sends_only_the_lobby_state():
    game, key, host, players, ids = await lobby_of(["Ann"])
    await players["Ann"].disconnect()
    ann = await reconnect(game.code, await token_for(ids["Ann"]))
    assert await ann.receive_nothing(timeout=0.3)
    await hang_up(ann, host)


async def test_ping_is_answered_with_pong():
    game, key, host, players, ids = await lobby_of(["Ann"])
    await send(players["Ann"], "PING")
    assert await players["Ann"].receive_json_from(timeout=2) == {"type": "PONG", "payload": {}}
    await hang_up(host, *players.values())


async def test_an_old_socket_closing_late_does_not_mark_a_reconnected_player_offline():
    game, key, host, players, ids = await lobby_of(["Ann"])
    # The new socket joins before the server notices the old one is dead.
    fresh = await reconnect(game.code, await token_for(ids["Ann"]))
    await send(fresh, "LOBBY_JOIN")
    await receive_until(fresh, "LOBBY_STATE")
    await players["Ann"].disconnect()  # the stale socket finally times out

    row = await database_sync_to_async(Player.objects.get)(pk=ids["Ann"])
    assert row.is_connected is True
    await fresh.disconnect()
    row = await database_sync_to_async(Player.objects.get)(pk=ids["Ann"])
    assert row.is_connected is False
    await host.disconnect()


# ---- the server lost the game's timer (restart) ---------------------------------------------


async def test_game_keeps_running_after_the_timer_is_lost_and_a_player_reconnects():
    game, key, host, players, ids = await lobby_of(["Ann"], questions=2, time_limit=1)
    await send(host, "HOST_START")
    first = await receive_until(players["Ann"], "QUESTION_PUSH")
    await hang_up(host, *players.values())

    await timer.shutdown()  # the "restart": every timer task is gone, the DB is untouched
    assert timer.get_runner(game.code) is None
    ann = await reconnect(game.code, await token_for(ids["Ann"]))
    await send(ann, "LOBBY_JOIN")

    # The question that was open is restored, then the revived timer plays out the whole game.
    restored = await receive_until(ann, "QUESTION_PUSH")
    assert restored["id"] == first["id"] and restored["startedAtMs"] == first["startedAtMs"]
    await receive_until(ann, "SCORE_SYNC", timeout=4)
    assert (await receive_until(ann, "QUESTION_PUSH", timeout=4))["index"] == 1
    await receive_until(ann, "SCORE_SYNC", timeout=4)
    final = await receive_until(ann, "GAME_END", timeout=4)
    assert final["leaderboard"][0]["nickname"] == "Ann"

    game = await database_sync_to_async(GameSession.objects.get)(pk=game.pk)
    assert game.status == "FINISHED"
    await ann.disconnect()


def test_resume_point_reads_the_phase_from_the_database(settings):
    settings.TRIVIA_REVEAL_SECONDS = 5.0
    host = User.objects.create_user("h", password="pw-for-tests-123", role=User.Role.HOST)
    quiz = Quiz.objects.create(owner=host, title="q", is_published=True)
    game = GameSession.objects.create(quiz=quiz, host=host, status=GameSession.Status.IN_PROGRESS)
    add_questions(game, 3, time_limit=20)

    point = gameplay.resume_point(game.code)
    assert (point.index, point.phase) == (0, "start")

    now = timezone.now()
    GameSession.objects.filter(pk=game.pk).update(
        current_question_index=1, question_started_at=now - timedelta(seconds=8)
    )
    point = gameplay.resume_point(game.code)
    assert (point.index, point.phase) == (1, "question")
    assert 11 < point.remaining <= 12

    GameSession.objects.filter(pk=game.pk).update(
        question_started_at=None, question_closed_at=now - timedelta(seconds=2)
    )
    point = gameplay.resume_point(game.code)
    assert (point.index, point.phase) == (1, "reveal")
    assert 2 < point.remaining <= 3

    GameSession.objects.filter(pk=game.pk).update(question_closed_at=now - timedelta(seconds=60))
    assert gameplay.resume_point(game.code).remaining == 0  # long outage: skip ahead

    GameSession.objects.filter(pk=game.pk).update(status=GameSession.Status.FINISHED)
    assert gameplay.resume_point(game.code) is None
