"""Answer rules, speed-weighted points, and the 'no lost points under concurrency' check (F11/F12).

These call the service layer directly (no sockets) so timestamps are exact. Transactional
tests are used because the concurrency tests run real threads, each with its own DB
connection; they only see committed rows.
"""
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest
from django.db import connections

from apps.accounts.models import User
from apps.games.models import Answer, GameSession, Player
from apps.games.schemas import ProtocolError
from apps.games.services import gameplay, scoring
from apps.quizzes.models import Choice, Question, Quiz

pytestmark = pytest.mark.django_db(transaction=True)


# ---- fixtures / helpers -------------------------------------------------------------------


def build_game(player_names=("Ann",), questions=2, time_limit=20, points=1000):
    """A started game (IN_PROGRESS) with question 0 open. Choice 0 is correct, choice 1 wrong."""
    host = User.objects.create_user("host", password="pw-for-tests-123", role=User.Role.HOST)
    quiz = Quiz.objects.create(owner=host, title="Quiz", is_published=True)
    qs = []
    for i in range(questions):
        q = Question.objects.create(
            quiz=quiz, text=f"Q{i}", order=i, time_limit_s=time_limit, points=points
        )
        Choice.objects.create(question=q, text="right", is_correct=True)
        Choice.objects.create(question=q, text="wrong")
        qs.append(q)
    game = GameSession.objects.create(
        quiz=quiz, host=host, status=GameSession.Status.IN_PROGRESS
    )
    players = [Player.objects.create(session=game, nickname=n) for n in player_names]
    gameplay.open_question(game.code, 0)
    game.refresh_from_db()
    return game, qs, players


def right(q):
    return q.choices.get(is_correct=True)


def wrong(q):
    return q.choices.get(is_correct=False)


def submit(player, q, choice, now=None):
    return scoring.submit_answer(
        player_id=player.pk, question_id=q.pk, choice_id=choice.pk, now=now
    )


def score(player) -> int:
    return Player.objects.get(pk=player.pk).score


def code_of(exc: ProtocolError) -> str:
    return exc.code


def run_together(jobs):
    """Run callables on separate threads released at the same instant; return their outcomes."""
    barrier = threading.Barrier(len(jobs))

    def worker(job):
        try:
            barrier.wait(timeout=10)
            return ("ok", job())
        except ProtocolError as err:
            return ("err", err.code)
        finally:
            connections.close_all()  # each thread opened its own connection

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        return [f.result() for f in [pool.submit(worker, j) for j in jobs]]


# ---- points formula -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("elapsed", "expected"),
    [(0, 1000), (5, 875), (10, 750), (20, 500), (35, 500), (-3, 1000)],
)
def test_compute_points_speed_weighting(elapsed, expected):
    assert scoring.compute_points(1000, 20, elapsed) == expected


# ---- answer rules -------------------------------------------------------------------------


def test_correct_answer_scores_by_speed():
    game, (q0, _), (ann, bob, cy) = build_game(("Ann", "Bob", "Cy"))
    start = game.question_started_at

    assert submit(ann, q0, right(q0), now=start).points_awarded == 1000
    assert submit(bob, q0, right(q0), now=start + timedelta(seconds=10)).points_awarded == 750
    assert submit(cy, q0, right(q0), now=start + timedelta(seconds=20)).points_awarded == 500
    assert [score(p) for p in (ann, bob, cy)] == [1000, 750, 500]


def test_wrong_answer_scores_nothing_but_is_recorded():
    game, (q0, _), (ann,) = build_game()
    answer = submit(ann, q0, wrong(q0), now=game.question_started_at)
    assert (answer.is_correct, answer.points_awarded) == (False, 0)
    assert score(ann) == 0


def test_second_answer_to_same_question_is_rejected_and_score_not_doubled():
    game, (q0, _), (ann,) = build_game()
    submit(ann, q0, right(q0), now=game.question_started_at)
    with pytest.raises(ProtocolError) as err:
        submit(ann, q0, right(q0), now=game.question_started_at)
    assert code_of(err.value) == "already_answered"
    assert score(ann) == 1000
    assert Answer.objects.filter(player=ann).count() == 1


def test_grace_window_then_too_late():
    game, (q0, _), (ann, bob) = build_game(("Ann", "Bob"))
    start = game.question_started_at
    # 0.5 s over the limit is inside the network grace: accepted, floor of 50 %
    assert submit(ann, q0, right(q0), now=start + timedelta(seconds=20.5)).points_awarded == 500
    with pytest.raises(ProtocolError) as err:
        submit(bob, q0, right(q0), now=start + timedelta(seconds=21))
    assert code_of(err.value) == "too_late"
    assert score(bob) == 0 and not Answer.objects.filter(player=bob).exists()


def test_only_the_open_question_with_its_own_choices_accepts_answers():
    game, (q0, q1), (ann,) = build_game()
    with pytest.raises(ProtocolError) as err:  # q1 exists but is not the open one yet
        submit(ann, q1, right(q1))
    assert code_of(err.value) == "question_closed"
    with pytest.raises(ProtocolError) as err:  # a choice from another question
        submit(ann, q0, right(q1))
    assert code_of(err.value) == "invalid_choice"

    gameplay.close_question(game.code)  # between questions nothing is accepted
    with pytest.raises(ProtocolError) as err:
        submit(ann, q0, right(q0))
    assert code_of(err.value) == "question_closed"
    assert score(ann) == 0


def test_kicked_player_cannot_answer():
    game, (q0, _), (ann,) = build_game()
    Player.objects.filter(pk=ann.pk).update(is_kicked=True)
    with pytest.raises(ProtocolError) as err:
        submit(ann, q0, right(q0))
    assert code_of(err.value) == "permission_denied"


def test_close_question_reports_answer_key_awards_and_ranking():
    game, (q0, _), (ann, bob) = build_game(("Ann", "Bob"))
    submit(ann, q0, wrong(q0), now=game.question_started_at)
    submit(bob, q0, right(q0), now=game.question_started_at)

    result = gameplay.close_question(game.code)
    assert result["correctChoiceId"] == right(q0).pk
    assert [r["nickname"] for r in result["leaderboard"]] == ["Bob", "Ann"]
    assert sorted((a["playerId"], a["points"]) for a in result["awarded"]) == sorted(
        [(ann.pk, 0), (bob.pk, 1000)]
    )
    assert gameplay.close_question(game.code) is None  # closing twice is a no-op


def test_question_payload_never_leaks_the_answer():
    game, (q0, q1), _ = build_game()
    payload = gameplay.open_question(game.code, 1)
    assert payload["id"] == q1.pk and payload["index"] == 1 and payload["total"] == 2
    assert all(set(c) == {"id", "text"} for c in payload["choices"])
    assert gameplay.open_question(game.code, 2) is None  # past the last question


# ---- concurrency (F12 'done when') --------------------------------------------------------


def test_simultaneous_answers_from_many_players_lose_no_points():
    names = [f"P{i:02d}" for i in range(12)]
    game, (q0, _), players = build_game(names, time_limit=60)
    choice = right(q0)

    outcomes = run_together([lambda p=p: submit(p, q0, choice) for p in players])

    assert all(kind == "ok" for kind, _ in outcomes), outcomes
    assert Answer.objects.filter(question=q0).count() == 12
    for player in players:
        awarded = Answer.objects.get(player=player, question=q0).points_awarded
        assert awarded > 0
        assert score(player) == awarded  # the F() update landed exactly once per player
    total = sum(a.points_awarded for a in Answer.objects.filter(question=q0))
    assert sum(score(p) for p in players) == total


def test_one_player_double_submitting_at_once_is_scored_once():
    game, (q0, _), (ann,) = build_game(time_limit=60)
    choice = right(q0)

    outcomes = run_together([lambda: submit(ann, q0, choice) for _ in range(8)])

    assert [o for o in outcomes if o[0] == "ok"].__len__() == 1
    assert {code for kind, code in outcomes if kind == "err"} == {"already_answered"}
    answer = Answer.objects.get(player=ann, question=q0)
    assert score(ann) == answer.points_awarded > 0


def test_answers_racing_the_question_closing_are_never_half_counted():
    game, (q0, _), players = build_game([f"P{i}" for i in range(6)], time_limit=60)
    choice = right(q0)

    jobs = [lambda p=p: submit(p, q0, choice) for p in players]
    jobs.append(lambda: gameplay.close_question(game.code))
    outcomes = run_together(jobs)

    closed = next(o[1] for o in outcomes if o[0] == "ok" and isinstance(o[1], dict))
    on_board = {row["id"]: row["score"] for row in closed["leaderboard"]}
    for player in players:
        accepted = Answer.objects.filter(player=player, question=q0).exists()
        # accepted before the close  => its points are in the broadcast leaderboard;
        # rejected                  => no points anywhere
        assert (on_board[player.pk] > 0) == accepted
        assert score(player) == on_board[player.pk]
