"""The shared error envelope: every failure the API returns has the same shape."""

from unittest.mock import patch

import pytest
from django.urls import reverse
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.common_exceptions import NON_FIELD, _flatten, api_exception_handler

pytestmark = pytest.mark.django_db


class TestFlatten:
    def test_nested_errors_become_dotted_paths(self):
        errors = {"questions": [{}, {"choices": [{"text": ["Blank."]}, {}]}]}
        assert _flatten(errors) == {"questions.1.choices.0.text": ["Blank."]}

    def test_flat_message_lists_stay_under_their_field(self):
        assert _flatten({"title": ["Required.", "Too long."]}) == {
            "title": ["Required.", "Too long."]
        }

    def test_errors_with_no_field_land_under_non_field_errors(self):
        assert _flatten(["Something is off."]) == {NON_FIELD: ["Something is off."]}
        assert _flatten("plain text") == {NON_FIELD: ["plain text"]}

    def test_messages_from_different_branches_are_merged(self):
        errors = {"a": {"x": ["one"]}, "a.x": ["two"]}
        assert _flatten(errors)["a.x"] == ["one", "two"]


class TestHandler:
    def test_validation_error_has_fields(self):
        response = api_exception_handler(ValidationError({"title": ["Required."]}), {"view": None})
        assert response.status_code == 400
        assert response.data == {
            "code": "validation_error",
            "detail": "Please fix the highlighted fields.",
            "fields": {"title": ["Required."]},
        }

    def test_not_found_has_code_and_detail_but_no_fields(self):
        response = api_exception_handler(NotFound(), {"view": None})
        assert response.status_code == 404
        assert response.data["code"] == "not_found"
        assert "fields" not in response.data

    def test_an_unexpected_exception_becomes_a_500_envelope_without_leaking_details(self):
        with patch("apps.common_exceptions.logger"):
            response = api_exception_handler(
                RuntimeError("secret database password"), {"view": None}
            )
        assert response.status_code == 500
        assert response.data == {
            "code": "server_error",
            "detail": "Something went wrong on our side.",
        }

    def test_serializer_errors_raised_in_a_view_are_flattened_too(self):
        class S(serializers.Serializer):
            a = serializers.IntegerField()

        s = S(data={"a": "x"})
        with pytest.raises(ValidationError) as caught:
            s.is_valid(raise_exception=True)
        response = api_exception_handler(caught.value, {"view": None})
        assert list(response.data["fields"]) == ["a"]


class TestEnvelopeOverHttp:
    """The status codes the frontend has a message for: 400, 401, 403, 404 and 500."""

    def host_client(self) -> APIClient:
        client = APIClient()
        client.force_authenticate(
            User.objects.create_user("hannah", password="pw-for-tests-123", role=User.Role.HOST)
        )
        return client

    def test_400(self):
        response = APIClient().post(reverse("register"), {}, format="json")
        assert response.status_code == 400
        assert response.json()["code"] == "validation_error"
        assert "username" in response.json()["fields"]

    def test_401(self):
        response = APIClient().get(reverse("me"))
        assert response.status_code == 401
        assert set(response.json()) == {"code", "detail"}

    def test_403(self):
        player = User.objects.create_user("pat", password="pw-for-tests-123", role=User.Role.PLAYER)
        client = APIClient()
        client.force_authenticate(player)
        response = client.get(reverse("game-history"))
        assert response.status_code == 403
        assert response.json()["code"] == "permission_denied"

    def test_404(self):
        response = self.host_client().get(reverse("game-results", args=["ZZZZZZ"]))
        assert response.status_code == 404
        assert response.json()["code"] == "not_found"

    def test_405(self):
        response = self.host_client().delete(reverse("me"))
        assert response.status_code == 405
        assert response.json()["code"] == "method_not_allowed"

    def test_500_is_the_same_envelope(self):
        client = self.host_client()
        client.raise_request_exception = False
        with (
            patch("apps.games.views.history.finished_games", side_effect=RuntimeError("boom")),
            patch("apps.common_exceptions.logger"),
        ):
            response = client.get(reverse("game-history"))
        assert response.status_code == 500
        assert response.json() == {
            "code": "server_error",
            "detail": "Something went wrong on our side.",
        }
