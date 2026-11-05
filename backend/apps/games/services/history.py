"""Finished-game history for hosts (F15): the list, one game's results, and the CSV export.

Everything is read from the rows Phase 4 already saves (GameSession / Player / Answer), so a game
becomes "history" the moment `gameplay.finish_game` flips it to FINISHED -- there is no separate
copy to keep in sync. Each function below runs a fixed, small number of queries however many
players or questions the game had (see test_history.py).

Known limitation: results are read live from the quiz, so deleting a quiz deletes its games
(`on_delete=CASCADE`), and editing a question's text changes what old results display.
"""
import csv
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from django.db.models import Count, Prefetch, QuerySet

from apps.quizzes.models import Question

from ..models import Answer, GameSession, Player

# Spreadsheets run any cell that starts with one of these as a formula. Nicknames are typed by
# anonymous guests, so an export of them has to defuse that ("=HYPERLINK(...)", "@SUM(...)").
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

CSV_HEADER = [
    "rank",
    "nickname",
    "total_score",
    "question_number",
    "question",
    "answered",
    "chosen_answer",
    "correct_answer",
    "is_correct",
    "points_awarded",
    "answered_at",
]


def finished_games(host) -> QuerySet[GameSession]:
    """The host's FINISHED games, newest first, with what the list row needs prefetched."""
    return (
        GameSession.objects.filter(host=host, status=GameSession.Status.FINISHED)
        .select_related("quiz")
        .annotate(question_total=Count("quiz__questions", distinct=True))
        .prefetch_related(
            Prefetch(
                "players",
                queryset=Player.objects.filter(is_kicked=False),  # Meta ordering: best score first
                to_attr="standings",
            )
        )
        .order_by("-ended_at", "-id")
    )


def rank_players(players: list[Player]) -> list[tuple[int, Player]]:
    """(rank, player) for players already sorted best first. Equal scores share a rank (1,2,2,4)."""
    ranked: list[tuple[int, Player]] = []
    for position, player in enumerate(players, start=1):
        if ranked and ranked[-1][1].score == player.score:
            ranked.append((ranked[-1][0], player))
        else:
            ranked.append((position, player))
    return ranked


@dataclass
class _Loaded:
    game: GameSession
    ranked: list[tuple[int, Player]]
    questions: list[Question]
    answers: dict[tuple[int, int], Answer]  # (player_id, question_id) -> that player's answer


def _load(game: GameSession) -> _Loaded:
    """Four queries: players, questions (+ their choices), answers (+ the choice picked)."""
    players = list(Player.objects.filter(session=game, is_kicked=False))
    questions = list(Question.objects.filter(quiz_id=game.quiz_id).prefetch_related("choices"))
    answers = {
        (a.player_id, a.question_id): a
        for a in Answer.objects.filter(
            player__session=game, player__is_kicked=False
        ).select_related("choice")
    }
    return _Loaded(game, rank_players(players), questions, answers)


def build_results(game: GameSession) -> dict[str, Any]:
    """Everything the results page shows: final standings and a breakdown per question."""
    data = _load(game)

    standings = []
    for rank, player in data.ranked:
        mine = [data.answers.get((player.pk, q.pk)) for q in data.questions]
        standings.append(
            {
                "rank": rank,
                "player_id": player.pk,
                "nickname": player.nickname,
                "score": player.score,
                "answered_count": sum(a is not None for a in mine),
                "correct_count": sum(a is not None and a.is_correct for a in mine),
            }
        )

    questions = []
    for number, question in enumerate(data.questions, start=1):
        picks: dict[int, int] = {}
        answered = correct = 0
        for _, player in data.ranked:
            answer = data.answers.get((player.pk, question.pk))
            if answer is None:
                continue
            answered += 1
            correct += answer.is_correct
            picks[answer.choice_id] = picks.get(answer.choice_id, 0) + 1
        questions.append(
            {
                "id": question.pk,
                "number": number,
                "text": question.text,
                "points": question.points,
                "time_limit_s": question.time_limit_s,
                "answered_count": answered,
                "correct_count": correct,
                "choices": [
                    {
                        "id": c.pk,
                        "text": c.text,
                        "is_correct": c.is_correct,
                        "picked_count": picks.get(c.pk, 0),
                    }
                    for c in question.choices.all()
                ],
            }
        )

    return {
        "code": game.code,
        "quiz_title": game.quiz.title,
        "started_at": game.started_at,
        "ended_at": game.ended_at,
        "player_count": len(data.ranked),
        "question_count": len(data.questions),
        "standings": standings,
        "questions": questions,
    }


def csv_safe(value: object) -> str:
    """Text for a CSV cell, with spreadsheet formulas defused by a leading apostrophe."""
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(_FORMULA_PREFIXES) else text


def csv_rows(game: GameSession) -> Iterator[list[str]]:
    """Long format: one row per (player, question), best-ranked player first.

    A question a player skipped still gets its row (answered = "no"), so every player has the
    same number of rows and a pivot table lines up.
    """
    data = _load(game)
    yield CSV_HEADER
    for rank, player in data.ranked:
        for number, question in enumerate(data.questions, start=1):
            choices = list(question.choices.all())
            correct_text = next((c.text for c in choices if c.is_correct), "")
            answer = data.answers.get((player.pk, question.pk))
            yield [
                str(rank),
                csv_safe(player.nickname),
                str(player.score),
                str(number),
                csv_safe(question.text),
                "yes" if answer else "no",
                csv_safe(answer.choice.text) if answer else "",
                csv_safe(correct_text),
                ("yes" if answer.is_correct else "no") if answer else "",
                str(answer.points_awarded) if answer else "0",
                answer.answered_at.isoformat() if answer else "",
            ]


class _Echo:
    """Minimal file-like object: csv.writer calls write() and we just hand the text back."""

    def write(self, value: str) -> str:
        return value


def csv_lines(game: GameSession) -> Iterator[str]:
    """The export as text lines, ready to join. Starts with a BOM so Excel reads UTF-8 names."""
    writer = csv.writer(_Echo())
    yield "﻿"
    for row in csv_rows(game):
        yield writer.writerow(row)
