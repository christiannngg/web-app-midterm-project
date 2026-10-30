import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.quizzes.models import Choice, Question, Quiz

pytestmark = pytest.mark.django_db


# ---- helpers ------------------------------------------------------------------------------


def make_user(username: str, role: str = User.Role.HOST) -> User:
    return User.objects.create_user(username=username, password="pw-for-tests-123", role=role)


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


def choices(correct: int = 0, n: int = 4) -> list[dict]:
    return [{"text": f"Choice {i}", "is_correct": i == correct} for i in range(n)]


def question(text: str = "What is 2 + 2?", **overrides) -> dict:
    return {"text": text, "time_limit_s": 20, "points": 1000, "choices": choices(), **overrides}


def quiz_payload(n_questions: int = 2, **overrides) -> dict:
    return {
        "title": "Maths",
        "description": "Warm-up round",
        "is_published": False,
        "tags": ["maths"],
        "questions": [question(f"Question {i}") for i in range(n_questions)],
        **overrides,
    }


@pytest.fixture
def host() -> User:
    return make_user("hannah")


@pytest.fixture
def api(host) -> APIClient:
    return client_for(host)


def create_quiz(api: APIClient, **kwargs) -> dict:
    res = api.post(reverse("quiz-list"), quiz_payload(**kwargs), format="json")
    assert res.status_code == 201, res.data
    return res.data


def post(api, payload):
    return api.post(reverse("quiz-list"), payload, format="json")


# ---- create / read ------------------------------------------------------------------------


def test_host_builds_a_five_question_quiz(api, host):
    data = create_quiz(api, n_questions=5, tags=["Maths", " maths ", "Warm-up"])

    quiz = Quiz.objects.get(pk=data["id"])
    assert quiz.owner == host
    assert [q.order for q in quiz.questions.all()] == [0, 1, 2, 3, 4]  # assigned from position
    assert all(q.choices.count() == 4 for q in quiz.questions.all())
    assert data["tags"] == ["maths", "warm-up"]  # normalised + de-duplicated

    detail = api.get(reverse("quiz-detail", args=[data["id"]])).data
    assert [q["text"] for q in detail["questions"]] == [f"Question {i}" for i in range(5)]
    assert detail["questions"][0]["choices"][0]["is_correct"] is True


def test_client_supplied_order_is_ignored(api):
    payload = quiz_payload(2)
    payload["questions"][0]["order"] = 9
    res = post(api, payload)
    assert [q["order"] for q in res.data["questions"]] == [0, 1]


# ---- validation ---------------------------------------------------------------------------


def test_needs_at_least_two_choices(api):
    payload = quiz_payload(1)
    payload["questions"][0]["choices"] = choices(n=1)
    res = post(api, payload)
    assert res.status_code == 400
    assert res.data["code"] == "validation_error"
    assert res.data["fields"]["questions.0.choices"] == ["Add at least two choices."]
    assert Quiz.objects.count() == 0


@pytest.mark.parametrize("n_correct", [0, 2])
def test_needs_exactly_one_correct_choice(api, n_correct):
    payload = quiz_payload(2)
    payload["questions"][1]["choices"] = [
        {"text": f"C{i}", "is_correct": i < n_correct} for i in range(4)
    ]
    res = post(api, payload)
    assert res.status_code == 400
    assert res.data["fields"]["questions.1.choices"] == ["Mark exactly one choice as correct."]


def test_field_errors_use_dotted_paths(api):
    payload = quiz_payload(1, title="")
    payload["questions"][0]["text"] = ""
    payload["questions"][0]["time_limit_s"] = 1
    payload["questions"][0]["choices"][2]["text"] = ""
    fields = post(api, payload).data["fields"]
    assert "title" in fields
    assert "questions.0.text" in fields
    assert "questions.0.time_limit_s" in fields
    assert "questions.0.choices.2.text" in fields


def test_cannot_publish_without_questions(api):
    res = post(api, quiz_payload(0, is_published=True))
    assert res.status_code == 400
    assert "questions" in res.data["fields"]
    assert post(api, quiz_payload(0, is_published=False)).status_code == 201  # empty draft is OK


def test_too_many_tags(api):
    res = post(api, quiz_payload(1, tags=[f"tag{i}" for i in range(11)]))
    assert res.status_code == 400
    assert "tags" in res.data["fields"]


def test_ids_are_rejected_on_create(api):
    payload = quiz_payload(1)
    payload["questions"][0]["id"] = 12345
    res = post(api, payload)
    assert res.status_code == 400
    assert "questions.0.id" in res.data["fields"]


# ---- permissions / ownership --------------------------------------------------------------


def test_anonymous_is_401_and_players_are_403(api):
    url = reverse("quiz-list")
    assert APIClient().get(url).status_code == 401
    assert client_for(make_user("pat", User.Role.PLAYER)).get(url).status_code == 403


def test_hosts_only_see_their_own_quizzes(api):
    mine = create_quiz(api)
    other = make_user("olive")
    theirs = create_quiz(client_for(other), title="Olive's quiz")

    listing = api.get(reverse("quiz-list")).data
    assert [q["id"] for q in listing["results"]] == [mine["id"]]

    detail = reverse("quiz-detail", args=[theirs["id"]])
    assert api.get(detail).status_code == 404
    assert api.put(detail, quiz_payload(1), format="json").status_code == 404
    assert api.delete(detail).status_code == 404
    assert Quiz.objects.filter(pk=theirs["id"]).exists()


def test_owner_cannot_be_set_from_the_payload(api, host):
    other = make_user("olive")
    res = post(api, {**quiz_payload(1), "owner": other.pk})
    assert Quiz.objects.get(pk=res.data["id"]).owner == host


def test_patch_is_not_allowed(api):
    quiz = create_quiz(api)
    res = api.patch(reverse("quiz-detail", args=[quiz["id"]]), {"title": "x"}, format="json")
    assert res.status_code == 405


# ---- update (diff by id) ------------------------------------------------------------------


def test_update_keeps_ids_of_unchanged_rows(api):
    quiz = create_quiz(api, n_questions=3)
    url = reverse("quiz-detail", args=[quiz["id"]])
    first, second, third = quiz["questions"]

    payload = {
        **quiz,
        "title": "Renamed",
        "is_published": True,
        # drop `second`, reorder so `third` comes first, add a brand-new question at the end
        "questions": [
            third,
            {**first, "text": "Edited text"},
            question("Brand new"),
        ],
    }
    res = api.put(url, payload, format="json")
    assert res.status_code == 200, res.data

    questions = res.data["questions"]
    assert [q["id"] for q in questions[:2]] == [third["id"], first["id"]]  # same rows, reordered
    assert [q["order"] for q in questions] == [0, 1, 2]
    assert questions[1]["text"] == "Edited text"
    assert questions[2]["id"] not in {first["id"], second["id"], third["id"]}
    assert not Question.objects.filter(pk=second["id"]).exists()
    assert res.data["title"] == "Renamed"
    assert res.data["is_published"] is True


def test_update_keeps_choice_rows_and_applies_changes(api):
    quiz = create_quiz(api, n_questions=1)
    url = reverse("quiz-detail", args=[quiz["id"]])
    q = quiz["questions"][0]
    kept, dropped = q["choices"][1], q["choices"][3]

    q["choices"] = [
        {**q["choices"][0], "is_correct": False},
        {**kept, "text": "Reworded", "is_correct": True},
        q["choices"][2],
        {"text": "Newcomer", "is_correct": False},
    ]
    res = api.put(url, {**quiz, "questions": [q]}, format="json")
    assert res.status_code == 200, res.data

    saved = res.data["questions"][0]["choices"]
    assert Choice.objects.filter(pk=kept["id"], text="Reworded", is_correct=True).exists()
    assert not Choice.objects.filter(pk=dropped["id"]).exists()
    assert [c["text"] for c in saved] == ["Choice 0", "Reworded", "Choice 2", "Newcomer"]


def test_update_rejects_ids_from_another_quiz(api):
    mine = create_quiz(api, n_questions=1)
    theirs = create_quiz(client_for(make_user("olive")), n_questions=1)
    url = reverse("quiz-detail", args=[mine["id"]])

    stolen_question = {**theirs["questions"][0]}
    res = api.put(url, {**mine, "questions": [stolen_question]}, format="json")
    assert res.status_code == 400
    assert "questions.0.id" in res.data["fields"]

    foreign_choice = {**mine["questions"][0]}
    foreign_choice["choices"] = [
        theirs["questions"][0]["choices"][0],
        *mine["questions"][0]["choices"][1:],
    ]
    res = api.put(url, {**mine, "questions": [foreign_choice]}, format="json")
    assert res.status_code == 400
    assert "questions.0.choices.0.id" in res.data["fields"]
    assert Question.objects.filter(pk=theirs["questions"][0]["id"]).exists()


def test_failed_update_changes_nothing(api):
    quiz = create_quiz(api, n_questions=2)
    url = reverse("quiz-detail", args=[quiz["id"]])
    bad = {**quiz, "title": "Should not stick"}
    bad["questions"] = [{**quiz["questions"][0], "choices": choices(n=1)}]
    assert api.put(url, bad, format="json").status_code == 400

    fresh = api.get(url).data
    assert fresh["title"] == "Maths"
    assert len(fresh["questions"]) == 2


def test_delete_removes_quiz_and_children(api):
    quiz = create_quiz(api, n_questions=2)
    assert api.delete(reverse("quiz-detail", args=[quiz["id"]])).status_code == 204
    assert not Question.objects.exists()
    assert not Choice.objects.exists()


# ---- search + pagination ------------------------------------------------------------------


def test_search_matches_title_description_and_tags(api):
    create_quiz(api, title="Capital cities", description="Geography", tags=["travel"])
    create_quiz(api, title="Chemistry", description="Periodic table", tags=["science", "lab"])
    create_quiz(api, title="Movies", description="Cinema trivia", tags=["fun"])
    url = reverse("quiz-list")

    def titles(term: str) -> list[str]:
        return [q["title"] for q in api.get(url, {"search": term}).data["results"]]

    assert titles("capital") == ["Capital cities"]
    assert titles("periodic") == ["Chemistry"]
    assert titles("science") == ["Chemistry"]
    assert titles("nothing-matches") == []
    assert api.get(url, {"search": "lab"}).data["count"] == 1  # joined tag rows aren't duplicated


def test_list_is_paginated_newest_first(api):
    for i in range(23):
        create_quiz(api, title=f"Quiz {i}", n_questions=0)
    url = reverse("quiz-list")

    page1 = api.get(url).data
    assert page1["count"] == 23
    assert len(page1["results"]) == 20
    assert page1["results"][0]["title"] == "Quiz 22"
    assert page1["next"] is not None

    page2 = api.get(url, {"page": 2}).data
    assert len(page2["results"]) == 3
    assert page2["next"] is None


def test_list_shows_question_count_and_tags_not_questions(api):
    create_quiz(api, n_questions=3, tags=["b", "a"])
    row = api.get(reverse("quiz-list")).data["results"][0]
    assert row["question_count"] == 3
    assert row["tags"] == ["a", "b"]
    assert "questions" not in row


# ---- query count --------------------------------------------------------------------------


def count_queries(api: APIClient, url: str, params: dict | None = None) -> int:
    with CaptureQueriesContext(connection) as ctx:
        assert api.get(url, params).status_code == 200
    return len(ctx)


def test_query_count_is_constant_as_questions_grow(api):
    """Detail and list must cost the same number of queries for 2 questions or 40."""
    small = create_quiz(api, title="Small", n_questions=2, tags=["a"])
    detail_small = count_queries(api, reverse("quiz-detail", args=[small["id"]]))
    list_small = count_queries(api, reverse("quiz-list"))

    big = create_quiz(api, title="Big", n_questions=40, tags=["a", "b", "c"])
    for _ in range(5):
        create_quiz(api, n_questions=10)  # more quizzes in the list as well

    assert count_queries(api, reverse("quiz-detail", args=[big["id"]])) == detail_small
    assert count_queries(api, reverse("quiz-list")) == list_small
    assert count_queries(api, reverse("quiz-list"), {"search": "a"}) <= list_small + 1
