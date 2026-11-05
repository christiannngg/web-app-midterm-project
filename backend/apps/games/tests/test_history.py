"""Phase 5 (F15): the host's game history, the results of one game, and the CSV export."""
import csv
import io
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.games.models import Answer, GameSession, Player
from apps.games.services.history import csv_safe, rank_players
from apps.quizzes.models import Choice, Question, Quiz

pytestmark = pytest.mark.django_db


def make_user(username: str, role: str = User.Role.HOST) -> User:
    return User.objects.create_user(username=username, password="pw-for-tests-123", role=role)


def client_for(user: User | None = None) -> APIClient:
    client = APIClient()
    if user:
        client.force_authenticate(user)
    return client


def make_quiz(host: User, questions: int = 3, title: str = "Capitals") -> Quiz:
    quiz = Quiz.objects.create(owner=host, title=title, is_published=True)
    for i in range(questions):
        q = Question.objects.create(quiz=quiz, text=f"Question {i + 1}", order=i, points=1000)
        Choice.objects.create(question=q, text=f"right {i + 1}", is_correct=True)
        Choice.objects.create(question=q, text=f"wrong {i + 1}")
    return quiz


def play(game: GameSession, nickname: str, picks: list[str | None]) -> Player:
    """A player who answered each question with "right", "wrong" or None (skipped it)."""
    player = Player.objects.create(session=game, nickname=nickname)
    score = 0
    for question, pick in zip(game.quiz.questions.all(), picks, strict=True):
        if pick is None:
            continue
        choice = question.choices.get(is_correct=(pick == "right"))
        points = 800 if choice.is_correct else 0
        score += points
        Answer.objects.create(
            player=player,
            question=question,
            choice=choice,
            is_correct=choice.is_correct,
            points_awarded=points,
        )
    Player.objects.filter(pk=player.pk).update(score=score)
    player.refresh_from_db()
    return player


def finished_game(host: User, quiz: Quiz | None = None, *, ended_ago_minutes: int = 0):
    quiz = quiz or make_quiz(host)
    now = timezone.now() - timedelta(minutes=ended_ago_minutes)
    return GameSession.objects.create(
        quiz=quiz,
        host=host,
        status=GameSession.Status.FINISHED,
        started_at=now - timedelta(minutes=5),
        ended_at=now,
    )


@pytest.fixture
def host() -> User:
    return make_user("hannah")


@pytest.fixture
def game(host) -> GameSession:
    game = finished_game(host)
    play(game, "Ann", ["right", "right", "right"])
    play(game, "Bob", ["right", "wrong", None])
    play(game, "Cy", ["wrong", "wrong", "wrong"])
    return game


# ---- history list ---------------------------------------------------------------------------


def test_history_lists_only_my_finished_games_newest_first(host):
    older = finished_game(host, ended_ago_minutes=60)
    newer = finished_game(host, ended_ago_minutes=5)
    GameSession.objects.create(quiz=make_quiz(host), host=host)  # still in the lobby
    in_progress = GameSession.objects.create(
        quiz=make_quiz(host), host=host, status=GameSession.Status.IN_PROGRESS
    )
    finished_game(make_user("olga"))  # someone else's

    response = client_for(host).get(reverse("game-history"))

    assert response.status_code == 200
    assert response.data["count"] == 2
    assert [row["code"] for row in response.data["results"]] == [newer.code, older.code]
    assert in_progress.code not in [row["code"] for row in response.data["results"]]


def test_history_row_has_title_counts_and_winner(game, host):
    row = client_for(host).get(reverse("game-history")).data["results"][0]
    assert row["quiz_title"] == "Capitals"
    assert (row["question_count"], row["player_count"]) == (3, 3)
    assert row["winner"] == {"nickname": "Ann", "score": 2400}
    assert row["ended_at"] is not None


def test_history_ignores_kicked_players_and_handles_empty_games(host):
    game = finished_game(host)
    kicked = play(game, "Troll", ["right", "right", "right"])
    Player.objects.filter(pk=kicked.pk).update(is_kicked=True)
    empty = finished_game(host)

    rows = {r["code"]: r for r in client_for(host).get(reverse("game-history")).data["results"]}
    assert rows[game.code]["player_count"] == 0 and rows[game.code]["winner"] is None
    assert rows[empty.code]["winner"] is None


def test_history_query_count_does_not_grow_with_the_number_of_games(host):
    def count_queries() -> int:
        with CaptureQueriesContext(connection) as ctx:
            assert client_for(host).get(reverse("game-history")).status_code == 200
        return len(ctx)

    finished_game(host)
    baseline = count_queries()
    for _ in range(6):
        g = finished_game(host)
        play(g, "Ann", ["right", "wrong", "right"])
        play(g, "Bob", ["wrong", "wrong", "wrong"])
    assert count_queries() == baseline


def test_history_is_host_only():
    assert client_for().get(reverse("game-history")).status_code == 401
    player = make_user("pat", role=User.Role.PLAYER)
    assert client_for(player).get(reverse("game-history")).status_code == 403


# ---- results --------------------------------------------------------------------------------


def results_url(game: GameSession) -> str:
    return reverse("game-results", kwargs={"code": game.code})


def export_url(game: GameSession) -> str:
    return reverse("game-export", kwargs={"code": game.code})


def test_results_have_ranked_standings_and_a_per_question_breakdown(game, host):
    data = client_for(host).get(results_url(game)).data

    assert data["code"] == game.code and data["quiz_title"] == "Capitals"
    assert (data["player_count"], data["question_count"]) == (3, 3)
    assert [(s["rank"], s["nickname"], s["score"]) for s in data["standings"]] == [
        (1, "Ann", 2400),
        (2, "Bob", 800),
        (3, "Cy", 0),
    ]
    bob = data["standings"][1]
    assert (bob["answered_count"], bob["correct_count"]) == (2, 1)

    q1, q2, q3 = data["questions"]
    assert (q1["answered_count"], q1["correct_count"]) == (3, 2)
    assert (q3["answered_count"], q3["correct_count"]) == (2, 1)  # Bob skipped it
    assert [(c["text"], c["picked_count"]) for c in q1["choices"]] == [
        ("right 1", 2),
        ("wrong 1", 1),
    ]
    assert [c["is_correct"] for c in q1["choices"]] == [True, False]


def test_tied_players_share_a_rank():
    class P:
        def __init__(self, score):
            self.score = score

    ranked = rank_players([P(900), P(500), P(500), P(0)])
    assert [rank for rank, _ in ranked] == [1, 2, 2, 4]


def test_results_exclude_kicked_players(game, host):
    Player.objects.filter(session=game, nickname="Ann").update(is_kicked=True)
    data = client_for(host).get(results_url(game)).data
    assert [s["nickname"] for s in data["standings"]] == ["Bob", "Cy"]
    assert data["questions"][0]["answered_count"] == 2


def test_results_query_count_does_not_grow_with_players_or_questions(host):
    def count_queries(g: GameSession) -> int:
        with CaptureQueriesContext(connection) as ctx:
            assert client_for(host).get(results_url(g)).status_code == 200
        return len(ctx)

    small = finished_game(host, make_quiz(host, questions=2))
    play(small, "A", ["right", "wrong"])
    big = finished_game(host, make_quiz(host, questions=8))
    for i in range(6):
        play(big, f"P{i}", ["right", "wrong"] * 4)
    assert count_queries(big) == count_queries(small)


def test_results_of_an_unfinished_game_are_409(host):
    live = GameSession.objects.create(
        quiz=make_quiz(host), host=host, status=GameSession.Status.IN_PROGRESS
    )
    response = client_for(host).get(results_url(live))
    assert response.status_code == 409
    assert response.data["code"] == "game_not_finished"


def test_another_hosts_results_look_like_a_missing_game(game):
    other = make_user("olga")
    assert client_for(other).get(results_url(game)).status_code == 404
    assert client_for(other).get(export_url(game)).status_code == 404


def test_results_and_export_require_a_host_login(game):
    assert client_for().get(results_url(game)).status_code == 401
    player = make_user("pat", role=User.Role.PLAYER)
    assert client_for(player).get(results_url(game)).status_code == 403
    assert client_for(player).get(export_url(game)).status_code == 403


# ---- CSV export -----------------------------------------------------------------------------


def parse_csv(response) -> list[list[str]]:
    body = b"".join(response.streaming_content) if response.streaming else response.content
    text = body.decode("utf-8")
    assert text.startswith("﻿")  # BOM: Excel reads the names as UTF-8
    return list(csv.reader(io.StringIO(text.lstrip("﻿"))))


def test_export_is_a_csv_download_with_one_row_per_player_per_question(game, host):
    response = client_for(host).get(export_url(game))

    assert response.status_code == 200
    assert response["Content-Type"].startswith("text/csv")
    disposition = response["Content-Disposition"]
    assert disposition == f'attachment; filename="trivia-{game.code}-results.csv"'
    rows = parse_csv(response)
    header, body = rows[0], rows[1:]
    assert header[:4] == ["rank", "nickname", "total_score", "question_number"]
    assert len(body) == 3 * 3  # 3 players x 3 questions, including the one Bob skipped

    by_key = {(r[1], r[3]): dict(zip(header, r, strict=True)) for r in body}
    ann = by_key[("Ann", "1")]
    assert (ann["rank"], ann["total_score"], ann["answered"]) == ("1", "2400", "yes")
    assert (ann["chosen_answer"], ann["correct_answer"]) == ("right 1", "right 1")
    assert (ann["is_correct"], ann["points_awarded"]) == ("yes", "800")
    assert ann["answered_at"] != ""

    cy = by_key[("Cy", "2")]
    assert (cy["chosen_answer"], cy["is_correct"], cy["points_awarded"]) == ("wrong 2", "no", "0")

    skipped = by_key[("Bob", "3")]
    assert skipped["answered"] == "no" and skipped["chosen_answer"] == ""
    assert (skipped["is_correct"], skipped["answered_at"]) == ("", "")
    assert skipped["correct_answer"] == "right 3" and skipped["points_awarded"] == "0"


def test_export_orders_rows_by_rank_then_question(game, host):
    body = parse_csv(client_for(host).get(export_url(game)))[1:]
    assert [(r[1], r[3]) for r in body] == [
        (nick, str(n)) for nick in ("Ann", "Bob", "Cy") for n in (1, 2, 3)
    ]


def test_export_defuses_spreadsheet_formulas_in_guest_nicknames(host):
    game = finished_game(host)
    play(game, '=HYPERLINK("http://evil.example","click")', ["right", "right", "right"])
    play(game, "@SUM(1+1)", ["right", "right", "right"])
    play(game, "+1-1", ["right", "right", "right"])

    body = parse_csv(client_for(host).get(export_url(game)))[1:]
    nicknames = {r[1] for r in body}
    assert nicknames == {'\'=HYPERLINK("http://evil.example","click")', "'@SUM(1+1)", "'+1-1"}


def test_csv_safe_leaves_ordinary_text_alone():
    assert csv_safe("Ann") == "Ann"
    assert csv_safe("Élodie, the 2nd") == "Élodie, the 2nd"
    assert csv_safe("=1+1") == "'=1+1"
    assert csv_safe(None) == ""
    assert csv_safe(12) == "12"


def test_export_of_an_unfinished_game_is_409(host):
    live = GameSession.objects.create(quiz=make_quiz(host), host=host)
    assert client_for(host).get(export_url(live)).status_code == 409
