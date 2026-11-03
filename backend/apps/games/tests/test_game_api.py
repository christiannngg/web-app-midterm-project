import re

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.games.models import GameSession, Player
from apps.games.tokens import make_player_token, read_player_token
from apps.quizzes.models import Quiz

pytestmark = pytest.mark.django_db


def make_user(username: str, role: str = User.Role.HOST) -> User:
    return User.objects.create_user(username=username, password="pw-for-tests-123", role=role)


def client_for(user: User | None = None) -> APIClient:
    client = APIClient()
    if user:
        client.force_authenticate(user)
    return client


@pytest.fixture
def host() -> User:
    return make_user("hannah")


@pytest.fixture
def quiz(host) -> Quiz:
    return Quiz.objects.create(owner=host, title="Capitals", is_published=True)


@pytest.fixture
def game(host, quiz) -> GameSession:
    return GameSession.objects.create(quiz=quiz, host=host)


def create_game(client: APIClient, quiz_id: int):
    return client.post(reverse("game-list"), {"quiz": quiz_id}, format="json")


def join(client: APIClient, code: str, nickname: str):
    return client.post(reverse("game-join"), {"code": code, "nickname": nickname}, format="json")


# ---- create ---------------------------------------------------------------------------------


def test_host_creates_game_with_unique_six_char_code(host, quiz):
    first = create_game(client_for(host), quiz.id)
    second = create_game(client_for(host), quiz.id)
    assert first.status_code == 201
    assert re.fullmatch(r"[A-Z0-9]{6}", first.data["code"])
    assert first.data["status"] == "LOBBY"
    assert first.data["quiz_title"] == "Capitals"
    assert first.data["code"] != second.data["code"]
    assert GameSession.objects.get(code=first.data["code"]).host == host


def test_code_collision_is_retried(host, quiz, monkeypatch):
    existing = GameSession.objects.create(quiz=quiz, host=host)
    draws = iter([existing.code, existing.code, "ZZZZZZ"])  # two collisions, then a free code
    # Field.get_default() calls the cached `_get_default`; replace it for this test only.
    monkeypatch.setattr(GameSession._meta.get_field("code"), "_get_default", lambda: next(draws))
    res = create_game(client_for(host), quiz.id)
    assert res.status_code == 201
    assert res.data["code"] == "ZZZZZZ"


def test_players_and_anonymous_cannot_create(quiz):
    assert create_game(client_for(), quiz.id).status_code == 401
    player = make_user("pete", role=User.Role.PLAYER)
    assert create_game(client_for(player), quiz.id).status_code == 403


def test_cannot_host_unpublished_or_foreign_quiz(host, quiz):
    draft = Quiz.objects.create(owner=host, title="Draft")
    res = create_game(client_for(host), draft.id)
    assert res.status_code == 400
    assert "quiz" in res.data["fields"]

    other = make_user("olga")
    res = create_game(client_for(other), quiz.id)  # published, but not hers
    assert res.status_code == 400
    assert "quiz" in res.data["fields"]


# ---- retrieve -------------------------------------------------------------------------------


def test_retrieve_is_public(game):
    res = client_for().get(reverse("game-detail", args=[game.code]))
    assert res.status_code == 200
    assert res.data["code"] == game.code
    assert res.data["is_locked"] is False


def test_retrieve_unknown_code_is_404():
    res = client_for().get(reverse("game-detail", args=["AAAAAA"]))
    assert res.status_code == 404


# ---- join -----------------------------------------------------------------------------------


def test_guest_joins_and_gets_a_player_token(game):
    res = join(client_for(), game.code, "  Ann  ")
    assert res.status_code == 201
    assert res.data["code"] == game.code
    assert res.data["player"]["nickname"] == "Ann"  # trimmed
    player = Player.objects.get(pk=res.data["player"]["id"])
    assert player.user is None
    assert player.is_connected is False  # flips to True when the socket sends LOBBY_JOIN
    assert read_player_token(res.data["player_token"]) == (player.pk, game.code)


def test_code_is_case_insensitive(game):
    assert join(client_for(), game.code.lower(), "Ann").status_code == 201


def test_unknown_code_is_a_field_error():
    res = join(client_for(), "NOPE22", "Ann")
    assert res.status_code == 400
    assert res.data["fields"]["code"] == ["No game found with that code."]


def test_nickname_must_be_unique_ignoring_case(game):
    assert join(client_for(), game.code, "Ann").status_code == 201
    res = join(client_for(), game.code, "ann")
    assert res.status_code == 400
    assert "nickname" in res.data["fields"]


def test_blank_nickname_rejected(game):
    res = join(client_for(), game.code, "   ")
    assert res.status_code == 400
    assert "nickname" in res.data["fields"]


def test_cannot_join_locked_or_started_lobby(game):
    game.is_locked = True
    game.save()
    assert "locked" in join(client_for(), game.code, "Ann").data["fields"]["code"][0]

    game.is_locked = False
    game.status = GameSession.Status.IN_PROGRESS
    game.save()
    assert "already started" in join(client_for(), game.code, "Ann").data["fields"]["code"][0]


def test_account_player_is_linked_and_rejoin_returns_same_seat(game):
    pete = make_user("pete", role=User.Role.PLAYER)
    first = join(client_for(pete), game.code, "Pete")
    assert first.status_code == 201
    assert Player.objects.get(pk=first.data["player"]["id"]).user == pete

    game.is_locked = True  # even a locked lobby lets an existing seat reconnect
    game.save()
    again = join(client_for(pete), game.code, "Whatever")
    assert again.status_code == 200
    assert again.data["player"]["id"] == first.data["player"]["id"]
    assert Player.objects.filter(session=game).count() == 1


def test_kicked_account_cannot_rejoin(game):
    pete = make_user("pete", role=User.Role.PLAYER)
    first = join(client_for(pete), game.code, "Pete")
    Player.objects.filter(pk=first.data["player"]["id"]).update(is_kicked=True)
    res = join(client_for(pete), game.code, "Pete")
    assert res.status_code == 400
    assert "removed" in res.data["fields"]["code"][0]


def test_host_account_joins_as_guest(game, host):
    """Lets one browser profile play host + player windows while testing."""
    res = join(client_for(host), game.code, "Hannah")
    assert res.status_code == 201
    assert Player.objects.get(pk=res.data["player"]["id"]).user is None


# ---- tokens ---------------------------------------------------------------------------------


def test_player_token_rejects_garbage_and_tampering(game):
    player = Player.objects.create(session=game, nickname="Ann")
    token = make_player_token(player)
    assert read_player_token(token) == (player.pk, game.code)
    assert read_player_token(token + "x") is None
    assert read_player_token("not-a-token") is None
