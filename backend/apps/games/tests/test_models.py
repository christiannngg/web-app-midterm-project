import re

import pytest
from django.db import IntegrityError, transaction

from apps.accounts.models import User
from apps.games.models import Answer, GameSession, Player
from apps.quizzes.models import Choice, Question, Quiz, Tag

pytestmark = pytest.mark.django_db


@pytest.fixture
def quiz():
    host = User.objects.create_user("host", password="x" * 12, role=User.Role.HOST)
    quiz = Quiz.objects.create(owner=host, title="Capitals")
    quiz.tags.add(Tag.objects.create(name="geo"))
    question = Question.objects.create(quiz=quiz, text="Capital of France?")
    Choice.objects.create(question=question, text="Paris", is_correct=True)
    Choice.objects.create(question=question, text="Rome")
    return quiz


@pytest.fixture
def session(quiz):
    return GameSession.objects.create(quiz=quiz, host=quiz.owner)


def test_join_code_is_six_chars_and_route_compatible(session):
    assert re.fullmatch(r"[A-Z0-9]{6}", session.code)  # matches games/routing.py
    assert session.status == GameSession.Status.LOBBY


def test_quiz_tag_many_to_many(quiz):
    assert [t.name for t in quiz.tags.all()] == ["geo"]
    assert Tag.objects.get(name="geo").quizzes.get() == quiz


def test_nickname_unique_per_session(session):
    Player.objects.create(session=session, nickname="ann")
    with pytest.raises(IntegrityError), transaction.atomic():
        Player.objects.create(session=session, nickname="ann")


def test_guests_may_share_null_user_but_accounts_join_once(session):
    Player.objects.create(session=session, nickname="g1")  # guest
    Player.objects.create(session=session, nickname="g2")  # guest
    user = User.objects.create_user("u", password="x" * 12)
    Player.objects.create(session=session, nickname="u1", user=user)
    with pytest.raises(IntegrityError), transaction.atomic():
        Player.objects.create(session=session, nickname="u2", user=user)


def test_one_answer_per_player_and_question(session, quiz):
    player = Player.objects.create(session=session, nickname="ann")
    question = quiz.questions.get()
    choice = question.choices.get(is_correct=True)
    Answer.objects.create(player=player, question=question, choice=choice, is_correct=True)
    with pytest.raises(IntegrityError), transaction.atomic():
        Answer.objects.create(player=player, question=question, choice=choice)
