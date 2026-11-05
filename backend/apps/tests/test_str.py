"""Every model prints something readable in the admin and in logs."""

import pytest

from apps.accounts.models import User
from apps.games.models import Answer, GameSession, Player
from apps.quizzes.models import Choice, Question, Quiz, Tag

pytestmark = pytest.mark.django_db


def test_model_strings_are_readable():
    host = User.objects.create_user("hannah", password="pw-for-tests-123", role=User.Role.HOST)
    quiz = Quiz.objects.create(owner=host, title="Capitals", is_published=True)
    quiz.tags.add(Tag.objects.create(name="geo"))
    question = Question.objects.create(quiz=quiz, text="Capital of France?", order=3)
    right = Choice.objects.create(question=question, text="Paris", is_correct=True)
    game = GameSession.objects.create(quiz=quiz, host=host)
    player = Player.objects.create(session=game, nickname="Ana")
    answer = Answer.objects.create(player=player, question=question, choice=right, is_correct=True)

    assert str(quiz) == "Capitals"
    assert str(quiz.tags.get()) == "geo"
    assert "Capital of France?" in str(question) and "#3" in str(question)
    assert str(right) == "Paris"
    assert str(game) == f"{game.code} (LOBBY)"
    assert str(player) == f"Ana @ {game.code}"
    assert "ok" in str(answer)
    assert str(host.profile) == "Profile<hannah>"
    assert host.is_host
