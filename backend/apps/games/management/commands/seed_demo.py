"""Fill the database with demo data, so the app looks lived-in for a demo or screenshots.

    python manage.py seed_demo            # create it (does nothing if it is already there)
    python manage.py seed_demo --reset    # delete the demo accounts and their data, then redo it

Creates:
  * a host account  (demo_host)   and a player account (demo_player), both with DEMO_PASSWORD
  * three quizzes for the host: two published, one draft, with tags
  * four finished games with players and answers, so History, Results and the CSV export have
    something to show on the first screen

The finished games are written straight to the tables the live game fills (GameSession, Player,
Answer), with points from the same `compute_points` the real scoring uses. The script plays them
with a fixed random seed, so every run gives the same standings.
"""

import random
from dataclasses import dataclass
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import User
from apps.games.models import Answer, GameSession, Player
from apps.games.services.scoring import compute_points
from apps.quizzes.models import Choice, Question, Quiz, Tag

HOST_USERNAME = "demo_host"
PLAYER_USERNAME = "demo_player"
DEMO_PASSWORD = "trivia-demo-123"


@dataclass(frozen=True)
class Q:
    text: str
    choices: tuple[str, str, str, str]
    correct: int  # index into choices
    time_limit_s: int = 20
    points: int = 1000


CAPITALS = [
    Q("What is the capital of France?", ("Paris", "Lyon", "Marseille", "Nice"), 0),
    Q("What is the capital of Japan?", ("Osaka", "Kyoto", "Tokyo", "Nagoya"), 2),
    Q(
        "What is the capital of Brazil?",
        ("Rio de Janeiro", "Brasília", "São Paulo", "Salvador"),
        1,
        25,
    ),
    Q("What is the capital of Canada?", ("Toronto", "Vancouver", "Montreal", "Ottawa"), 3),
    Q(
        "What is the capital of Australia?",
        ("Sydney", "Canberra", "Melbourne", "Perth"),
        1,
        25,
        1500,
    ),
]

WEB_BASICS = [
    Q("Which HTTP status means 'Not Found'?", ("200", "301", "404", "500"), 2, 15),
    Q("Which tag holds the main content of a page?", ("<div>", "<main>", "<span>", "<aside>"), 1),
    Q(
        "What does CSS stand for?",
        (
            "Cascading Style Sheets",
            "Computer Style Syntax",
            "Creative Style System",
            "Coded Style Sheets",
        ),
        0,
    ),
    Q(
        "Which method asks a server to create a resource?",
        ("GET", "DELETE", "POST", "HEAD"),
        2,
        20,
        1200,
    ),
    Q(
        "Which protocol keeps a two-way connection open between browser and server?",
        ("FTP", "SMTP", "WebSocket", "DNS"),
        2,
        25,
        1500,
    ),
]

SCIENCE_DRAFT = [
    Q("How many planets are in the solar system?", ("7", "8", "9", "10"), 1),
]

# (quiz title, description, tags, published, questions)
QUIZZES = [
    (
        "World Capitals",
        "Five capitals, one of them a trick question.",
        ["geography", "easy"],
        True,
        CAPITALS,
    ),
    (
        "Web Dev Basics",
        "HTTP, HTML, CSS and a little networking.",
        ["web", "tech"],
        True,
        WEB_BASICS,
    ),
    (
        "Solar System (draft)",
        "Not ready yet: add more questions before publishing.",
        ["science"],
        False,
        SCIENCE_DRAFT,
    ),
]

# (nickname, accuracy 0-1, average share of the time limit used before answering)
PLAYERS = [
    ("Ana", 0.95, 0.25),
    ("Ben", 0.80, 0.40),
    ("Cy", 0.65, 0.35),
    ("Dee", 0.50, 0.55),
    ("Eli", 0.35, 0.60),
    ("Fay", 0.20, 0.70),
]

# (quiz title, how many days ago it ended, how many of PLAYERS took part)
GAMES = [
    ("World Capitals", 6, 5),
    ("Web Dev Basics", 4, 6),
    ("World Capitals", 2, 4),
    ("Web Dev Basics", 0, 3),
]


class Command(BaseCommand):
    help = "Create demo accounts, quizzes and finished games (see the module docstring)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete the demo accounts (and their quizzes and games) first.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        exists = User.objects.filter(username=HOST_USERNAME).exists()
        if exists and not options["reset"]:
            self.stdout.write(
                self.style.WARNING("Demo data is already there. Use --reset to rebuild it.")
            )
            self._print_logins()
            return
        if options["reset"]:
            User.objects.filter(username__in=[HOST_USERNAME, PLAYER_USERNAME]).delete()

        host = User.objects.create_user(HOST_USERNAME, password=DEMO_PASSWORD, role=User.Role.HOST)
        User.objects.create_user(PLAYER_USERNAME, password=DEMO_PASSWORD, role=User.Role.PLAYER)

        quizzes = {entry[0]: self._make_quiz(host, *entry) for entry in QUIZZES}
        rng = random.Random(2026)  # fixed seed: the same standings on every machine
        for title, days_ago, player_count in GAMES:
            self._make_finished_game(host, quizzes[title], days_ago, PLAYERS[:player_count], rng)

        self.stdout.write(
            self.style.SUCCESS(
                f"Created {len(QUIZZES)} quizzes and {len(GAMES)} finished games "
                f"for {HOST_USERNAME}."
            )
        )
        self._print_logins()

    def _print_logins(self) -> None:
        self.stdout.write(f"  host:   {HOST_USERNAME} / {DEMO_PASSWORD}")
        self.stdout.write(f"  player: {PLAYER_USERNAME} / {DEMO_PASSWORD}")

    def _make_quiz(self, host, title, description, tag_names, published, questions) -> Quiz:
        quiz = Quiz.objects.create(
            owner=host, title=title, description=description, is_published=published
        )
        quiz.tags.set([Tag.objects.get_or_create(name=name)[0] for name in tag_names])
        for order, q in enumerate(questions):
            question = Question.objects.create(
                quiz=quiz, text=q.text, time_limit_s=q.time_limit_s, points=q.points, order=order
            )
            Choice.objects.bulk_create(
                Choice(question=question, text=text, is_correct=(i == q.correct))
                for i, text in enumerate(q.choices)
            )
        return quiz

    def _make_finished_game(self, host, quiz, days_ago, roster, rng) -> GameSession:
        ended = timezone.now() - timedelta(days=days_ago, minutes=rng.randint(0, 90))
        questions = list(quiz.questions.prefetch_related("choices").order_by("order", "id"))
        game = GameSession.objects.create(
            quiz=quiz,
            host=host,
            status=GameSession.Status.FINISHED,
            current_question_index=max(len(questions) - 1, 0),
            started_at=ended - timedelta(minutes=2 + len(questions)),
            ended_at=ended,
        )
        # created_at is auto_now_add: move it so the lobby "opened" before the game started.
        GameSession.objects.filter(pk=game.pk).update(
            created_at=game.started_at - timedelta(minutes=3)
        )

        for nickname, accuracy, slowness in roster:
            player = Player.objects.create(session=game, nickname=nickname)
            total = 0
            for question in questions:
                if rng.random() < 0.04:  # now and then somebody just misses the question
                    continue
                choices = list(question.choices.all())
                right = next(c for c in choices if c.is_correct)
                wrong = [c for c in choices if not c.is_correct]
                picked = right if rng.random() < accuracy else rng.choice(wrong)
                elapsed = question.time_limit_s * min(1.0, max(0.05, rng.gauss(slowness, 0.12)))
                points = (
                    compute_points(question.points, question.time_limit_s, elapsed)
                    if picked.is_correct
                    else 0
                )
                Answer.objects.create(
                    player=player,
                    question=question,
                    choice=picked,
                    is_correct=picked.is_correct,
                    points_awarded=points,
                )
                total += points
            Player.objects.filter(pk=player.pk).update(score=total)
        return game
