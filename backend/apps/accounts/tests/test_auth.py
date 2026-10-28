import pytest
from django.urls import reverse
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from apps.accounts.models import PlayerProfile, User
from apps.accounts.permissions import IsHost

PASSWORD = "correct-horse-battery"

pytestmark = pytest.mark.django_db


@pytest.fixture
def api() -> APIClient:
    return APIClient()


def register(api, username="hannah", role="host", password=PASSWORD):
    payload = {"username": username, "password": password, "role": role}
    return api.post(reverse("register"), payload, format="json")


def login(api, username="hannah", password=PASSWORD):
    return api.post(reverse("token_obtain_pair"), {"username": username, "password": password})


def test_register_host_login_and_me(api):
    res = register(api)
    assert res.status_code == 201
    assert res.data["role"] == "host"
    assert "password" not in res.data

    tokens = login(api).data
    assert set(tokens) == {"access", "refresh"}

    api.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    me = api.get(reverse("me"))
    assert me.status_code == 200
    assert me.data == {"id": res.data["id"], "username": "hannah", "role": "host"}


def test_register_defaults_to_player(api):
    res = api.post(reverse("register"), {"username": "pat", "password": PASSWORD})
    assert res.status_code == 201
    assert res.data["role"] == "player"


def test_register_creates_one_profile(api):
    register(api)
    user = User.objects.get(username="hannah")
    assert PlayerProfile.objects.filter(user=user).count() == 1
    assert user.profile.games_played == 0


def test_register_cannot_self_assign_admin_role(api):
    res = register(api, role="admin")
    assert res.status_code == 400
    assert "role" in res.data["fields"]
    assert not User.objects.filter(username="hannah").exists()


def test_register_validation_uses_error_envelope(api):
    register(api)
    res = register(api, password="123")  # duplicate username + weak password
    assert res.status_code == 400
    assert res.data["code"] == "validation_error"
    assert "username" in res.data["fields"]
    assert res.data["fields"]["password"]  # list of messages


def test_register_ignores_stale_authorization_header(api):
    api.credentials(HTTP_AUTHORIZATION="Bearer not-a-real-token")
    assert register(api).status_code == 201


def test_login_wrong_password_is_401_envelope(api):
    register(api)
    res = login(api, password="wrong-password-123")
    assert res.status_code == 401
    assert res.data["code"] == "no_active_account"
    assert res.data["detail"]


def test_me_requires_token(api):
    res = api.get(reverse("me"))
    assert res.status_code == 401
    assert set(res.data) == {"code", "detail"}
    assert res.data["code"] == "not_authenticated"


def test_me_rejects_garbage_token(api):
    api.credentials(HTTP_AUTHORIZATION="Bearer nope")
    res = api.get(reverse("me"))
    assert res.status_code == 401
    assert res.data["code"] == "token_not_valid"


def test_refresh_rotates_tokens(api):
    register(api)
    refresh = login(api).data["refresh"]
    res = api.post(reverse("token_refresh"), {"refresh": refresh})
    assert res.status_code == 200
    assert res.data["access"] and res.data["refresh"]


# --- IsHost guard ---------------------------------------------------------------------------
class HostOnlyView(APIView):
    permission_classes = [IsHost]

    def get(self, request):
        return Response({"ok": True})


def call_host_view(user):
    request = APIRequestFactory().get("/host-only/")
    if user is not None:
        force_authenticate(request, user=user)
    return HostOnlyView.as_view()(request)


def test_is_host_allows_host():
    host = User.objects.create_user("h", password=PASSWORD, role=User.Role.HOST)
    assert call_host_view(host).status_code == 200


def test_is_host_forbids_player_with_envelope():
    player = User.objects.create_user("p", password=PASSWORD, role=User.Role.PLAYER)
    res = call_host_view(player)
    assert res.status_code == 403
    assert res.data["code"] == "permission_denied"


def test_is_host_rejects_anonymous():
    assert call_host_view(None).status_code in (401, 403)


def test_register_rejects_password_similar_to_username(api):
    res = register(api, username="hannah-banana", password="hannah-banana")
    assert res.status_code == 400
    assert "password" in res.data["fields"]
