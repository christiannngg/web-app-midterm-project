"""`manage.py seed_demo`: demo accounts, quizzes and finished games for a demo or screenshots."""

from io import StringIO

import pytest
from django.core.management import call_command
from django.db.models import Sum
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.games.management.commands.seed_demo import (
    DEMO_PASSWORD,
    GAMES,
    HOST_USERNAME,
    PLAYER_USERNAME,
    QUIZZES,
)
from apps.games.models import Answer, GameSession, Player
from apps.quizzes.models import Quiz

pytestmark = pytest.mark.django_db


def seed(*args: str) -> str:
    out = StringIO()
    call_command("seed_demo", *args, stdout=out)
    return out.getvalue()


def standings() -> list[tuple[str, str, int]]:
    """(game code order is random, so) quiz title, nickname, score -- in a stable order."""
    return sorted(
        (p.session.quiz.title, p.nickname, p.score)
        for p in Player.objects.select_related("session__quiz")
    )


def test_creates_the_demo_accounts_with_the_documented_password():
    seed()
    host = User.objects.get(username=HOST_USERNAME)
    player = User.objects.get(username=PLAYER_USERNAME)
    assert host.is_host and host.check_password(DEMO_PASSWORD)
    assert not player.is_host and player.check_password(DEMO_PASSWORD)


def test_creates_quizzes_that_obey_the_authoring_rules():
    seed()
    assert Quiz.objects.count() == len(QUIZZES)
    published = Quiz.objects.filter(is_published=True)
    assert published.count() == 2
    for quiz in Quiz.objects.prefetch_related("questions__choices", "tags"):
        assert quiz.tags.count() >= 1
        assert quiz.questions.count() >= 1  # the same rule publishing enforces
        for question in quiz.questions.all():
            choices = list(question.choices.all())
            assert len(choices) >= 2
            assert sum(c.is_correct for c in choices) == 1


def test_creates_finished_games_whose_scores_match_their_answers():
    seed()
    games = GameSession.objects.all()
    assert games.count() == len(GAMES)
    assert all(g.status == GameSession.Status.FINISHED and g.ended_at for g in games)
    for player in Player.objects.all():
        earned = player.answers.aggregate(total=Sum("points_awarded"))["total"] or 0
        assert player.score == earned
    # Wrong answers earn nothing, right ones earn something.
    assert not Answer.objects.filter(is_correct=False).exclude(points_awarded=0).exists()
    assert not Answer.objects.filter(is_correct=True, points_awarded=0).exists()


def test_the_seeded_games_show_up_in_the_hosts_history_results_and_export():
    seed()
    client = APIClient()
    client.force_authenticate(User.objects.get(username=HOST_USERNAME))

    history = client.get(reverse("game-history"))
    assert history.status_code == 200
    assert history.data["count"] == len(GAMES)
    code = history.data["results"][0]["code"]

    results = client.get(reverse("game-results", args=[code]))
    assert results.status_code == 200
    assert results.data["standings"][0]["rank"] == 1

    export = client.get(reverse("game-export", args=[code]))
    assert export.status_code == 200
    assert export["Content-Type"].startswith("text/csv")


def test_running_it_twice_changes_nothing():
    seed()
    before = standings()
    output = seed()
    assert "already there" in output
    assert User.objects.filter(username=HOST_USERNAME).count() == 1
    assert Quiz.objects.count() == len(QUIZZES)
    assert standings() == before


def test_reset_rebuilds_the_same_data_without_duplicates():
    seed()
    before = standings()
    seed("--reset")
    assert User.objects.filter(username=HOST_USERNAME).count() == 1
    assert Quiz.objects.count() == len(QUIZZES)
    assert GameSession.objects.count() == len(GAMES)
    assert standings() == before  # fixed random seed: same standings on every run


def test_reset_leaves_other_peoples_accounts_alone():
    other = User.objects.create_user("someone_else", password="pw-for-tests-123", role="host")
    Quiz.objects.create(owner=other, title="Mine")
    seed()
    seed("--reset")
    assert User.objects.filter(pk=other.pk).exists()
    assert Quiz.objects.filter(owner=other, title="Mine").exists()
