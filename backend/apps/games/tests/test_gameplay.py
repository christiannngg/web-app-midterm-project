"""A whole game over real (in-memory) Channels sockets: timer, QUESTION_PUSH, answers, scoring,
SCORE_SYNC and GAME_END."""
import pytest
from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator

from apps.games.models import Answer, GameSession
from apps.quizzes.models import Choice, Question

from .test_lobby_consumer import (
    error_code,
    jwt_for,
    lobby_state,
    make_game,
    make_player,
    open_socket,
    send,
)

pytestmark = pytest.mark.django_db(transaction=True)

QUESTIONS = 5


async def receive_until(comm: WebsocketCommunicator, type_: str, timeout: float = 5) -> dict:
    """Next message of `type_`, skipping lobby/progress chatter in between."""
    while True:
        message = await comm.receive_json_from(timeout=timeout)
        if message["type"] == type_:
            return message["payload"]


def add_questions(game: GameSession, count: int, time_limit: int = 30) -> dict[int, dict]:
    """Questions 1..count after make_game's own question 0 is removed. Returns, per question
    id, {"right": choice id, "wrong": choice id}."""
    game.quiz.questions.all().delete()
    key = {}
    for i in range(count):
        q = Question.objects.create(
            quiz=game.quiz, text=f"Question {i + 1}", order=i, time_limit_s=time_limit
        )
        good = Choice.objects.create(question=q, text="right", is_correct=True)
        bad = Choice.objects.create(question=q, text="wrong")
        key[q.pk] = {"right": good.pk, "wrong": bad.pk}
    return key


async def lobby_of(names: list[str], questions: int = QUESTIONS, time_limit: int = 30):
    """Host + connected players, all sitting in the lobby, ready for HOST_START."""
    host_user, game = await database_sync_to_async(make_game)("hannah")
    key = await database_sync_to_async(add_questions)(game, questions, time_limit)
    host = await open_socket(game.code, jwt_for(host_user))
    await lobby_state(host)

    players: dict[str, WebsocketCommunicator] = {}
    ids: dict[str, int] = {}
    for name in names:  # one at a time, so each join's broadcast is easy to account for
        row, token = await database_sync_to_async(make_player)(game, name)
        comm = await open_socket(game.code, token)
        await lobby_state(comm)
        await send(comm, "LOBBY_JOIN")
        players[name], ids[name] = comm, row.pk
        await lobby_state(host)
    # A player hears every join from their own onward: the first player N times, the last once.
    for position, comm in enumerate(players.values()):
        for _ in range(len(names) - position):
            await lobby_state(comm)
    return game, key, host, players, ids


async def hang_up(*comms: WebsocketCommunicator) -> None:
    for comm in comms:
        await comm.disconnect()


async def test_full_five_question_game_with_three_players_ends_with_correct_scores():
    game, key, host, players, ids = await lobby_of(["Ann", "Bob", "Cy"])
    everyone = (host, *players.values())
    await send(host, "HOST_START")

    # Ann answers everything right, Bob the first 3, Cy gets everything wrong.
    right_count = {"Ann": QUESTIONS, "Bob": 3, "Cy": 0}
    for i in range(QUESTIONS):
        pushes = [await receive_until(c, "QUESTION_PUSH") for c in everyone]
        question = pushes[0]
        assert all(p == question for p in pushes)  # one shared question for the whole room
        assert (question["index"], question["total"]) == (i, QUESTIONS)
        assert question["timeLimitSeconds"] == 30
        assert question["startedAtMs"] == question["serverNowMs"]
        assert all(set(c) == {"id", "text"} for c in question["choices"])  # no answer key

        for name, comm in players.items():
            side = "right" if i < right_count[name] else "wrong"
            await send(
                comm,
                "ANSWER_SUBMIT",
                {"questionId": question["id"], "choiceId": key[question["id"]][side]},
            )

        # everyone answered, so the question closes immediately instead of waiting 30 s
        synced = [await receive_until(c, "SCORE_SYNC") for c in everyone]
        assert all(s == synced[0] for s in synced)
        assert synced[0]["correctChoiceId"] == key[question["id"]]["right"]
        assert len(synced[0]["awarded"]) == 3

    finals = [await receive_until(c, "GAME_END") for c in everyone]
    board = finals[0]["leaderboard"]
    assert all(f == finals[0] for f in finals)
    assert [p["nickname"] for p in board] == ["Ann", "Bob", "Cy"]

    # The broadcast scores equal the sum of each player's recorded answers, and a correct
    # answer is worth 50-100 % of the question's 1000 points.
    for row in board:
        answers = await database_sync_to_async(list)(Answer.objects.filter(player_id=row["id"]))
        assert len(answers) == QUESTIONS
        assert row["score"] == sum(a.points_awarded for a in answers)
        assert sum(a.is_correct for a in answers) == right_count[row["nickname"]]
        assert all(500 <= a.points_awarded <= 1000 for a in answers if a.is_correct)
        assert all(a.points_awarded == 0 for a in answers if not a.is_correct)
    scores = {p["nickname"]: p["score"] for p in board}
    assert scores["Ann"] >= QUESTIONS * 500 and scores["Bob"] >= 3 * 500 and scores["Cy"] == 0

    game = await database_sync_to_async(GameSession.objects.get)(pk=game.pk)
    assert game.status == "FINISHED" and game.ended_at is not None
    await hang_up(*everyone)


async def test_question_closes_by_itself_when_time_runs_out():
    game, key, host, players, ids = await lobby_of(["Ann"], questions=1, time_limit=1)
    await send(host, "HOST_START")
    push = await receive_until(players["Ann"], "QUESTION_PUSH")
    assert push["timeLimitSeconds"] == 1

    synced = await receive_until(players["Ann"], "SCORE_SYNC", timeout=4)  # nobody answered
    assert synced["awarded"] == [] and synced["leaderboard"][0]["score"] == 0
    assert synced["correctChoiceId"] == key[push["id"]]["right"]
    assert (await receive_until(players["Ann"], "GAME_END"))["leaderboard"][0]["nickname"] == "Ann"
    await hang_up(host, *players.values())


async def test_late_and_repeat_answers_are_refused_with_clear_errors():
    game, key, host, players, ids = await lobby_of(["Ann", "Bob"], questions=2)
    await send(host, "HOST_START")
    first = await receive_until(players["Ann"], "QUESTION_PUSH")
    ann = players["Ann"]
    answer = {"questionId": first["id"], "choiceId": key[first["id"]]["right"]}

    await send(ann, "ANSWER_SUBMIT", answer)
    progress = await receive_until(ann, "ANSWER_PROGRESS")
    assert progress == {"answered": 1, "total": 2}
    await send(ann, "ANSWER_SUBMIT", answer)  # Bob hasn't answered, so the question is still open
    assert await error_code(ann) == "already_answered"

    await receive_until(host, "ANSWER_PROGRESS")  # skip the lobby/question chatter queued up
    await send(host, "ANSWER_SUBMIT", answer)  # only players answer
    assert await error_code(host) == "permission_denied"
    await send(ann, "ANSWER_SUBMIT", {"questionId": "x", "choiceId": 1})
    assert await error_code(ann) == "bad_request"

    await send(players["Bob"], "ANSWER_SUBMIT", {**answer, "choiceId": key[first["id"]]["wrong"]})
    await receive_until(ann, "SCORE_SYNC")
    await send(ann, "ANSWER_SUBMIT", answer)  # that question is over now
    assert await error_code(ann) == "question_closed"
    await hang_up(host, *players.values())


async def test_host_can_skip_ahead_and_players_cannot():
    game, key, host, players, ids = await lobby_of(["Ann"], questions=2, time_limit=60)
    ann = players["Ann"]
    await send(host, "HOST_START")
    first = await receive_until(ann, "QUESTION_PUSH")

    await send(ann, "HOST_NEXT")
    assert await error_code(ann) == "permission_denied"

    await send(host, "HOST_NEXT")  # ends question 1 without waiting 60 s
    await receive_until(ann, "SCORE_SYNC", timeout=2)
    second = await receive_until(ann, "QUESTION_PUSH", timeout=2)
    assert second["index"] == 1 and second["id"] != first["id"]
    await hang_up(host, ann)


async def test_a_disconnect_that_leaves_everyone_answered_closes_the_question():
    game, key, host, players, ids = await lobby_of(["Ann", "Bob"], questions=1, time_limit=60)
    await send(host, "HOST_START")
    push = await receive_until(players["Ann"], "QUESTION_PUSH")
    await send(
        players["Ann"],
        "ANSWER_SUBMIT",
        {"questionId": push["id"], "choiceId": key[push["id"]]["right"]},
    )
    await receive_until(players["Ann"], "ANSWER_PROGRESS")

    await players["Bob"].disconnect()  # the only player we were still waiting for leaves
    await receive_until(host, "SCORE_SYNC", timeout=2)
    await hang_up(host, players["Ann"])


async def test_one_games_events_never_reach_another_game():
    game, key, host, players, ids = await lobby_of(["Ann"], questions=1, time_limit=60)
    other_user, other = await database_sync_to_async(make_game)("otto")
    bystander = await open_socket(other.code, jwt_for(other_user))
    await lobby_state(bystander)

    await send(host, "HOST_START")
    await receive_until(players["Ann"], "QUESTION_PUSH")
    assert await bystander.receive_nothing(timeout=0.3)  # no QUESTION_PUSH, no LOBBY_STATE
    other_state = await database_sync_to_async(GameSession.objects.get)(pk=other.pk)
    assert other_state.status == "LOBBY" and other_state.question_started_at is None
    await hang_up(host, players["Ann"], bystander)
