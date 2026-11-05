"""Serializers for the lobby REST endpoints (`/api/games/`).

Host-only history rows (`GET /api/games/history/`) are at the bottom.
"""
from django.db import IntegrityError, transaction
from rest_framework import serializers

from apps.quizzes.models import Quiz

from .models import GameSession, Player
from .tokens import make_player_token


class GameSessionSerializer(serializers.ModelSerializer):
    """Public view of a lobby: enough to render a title and decide whether joining makes sense."""

    quiz_title = serializers.CharField(source="quiz.title", read_only=True)

    class Meta:
        model = GameSession
        fields = ["id", "code", "status", "is_locked", "quiz", "quiz_title", "created_at"]
        read_only_fields = fields


class GameCreateSerializer(serializers.Serializer):
    quiz = serializers.PrimaryKeyRelatedField(queryset=Quiz.objects.none())

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        user = self.context["request"].user
        # Someone else's quiz looks exactly like a missing one (same as the quiz endpoints).
        self.fields["quiz"].queryset = Quiz.objects.filter(owner=user)

    def validate_quiz(self, quiz: Quiz) -> Quiz:
        # is_published already guarantees the quiz has at least one question.
        if not quiz.is_published:
            raise serializers.ValidationError("Publish this quiz before hosting a game.")
        return quiz


class JoinSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=6)
    nickname = serializers.CharField(max_length=30)  # trims whitespace, rejects blank

    def validate_code(self, value: str) -> str:
        return value.strip().upper()

    def validate(self, attrs: dict) -> dict:
        request = self.context["request"]
        game = GameSession.objects.filter(code=attrs["code"]).first()
        if game is None:
            raise serializers.ValidationError({"code": "No game found with that code."})

        # Hosts run games, they don't play in them: a host who joins (e.g. a second browser
        # window while testing) is a guest, so the account never collides with itself.
        user = request.user if request.user.is_authenticated else None
        if user is not None and user.is_host:
            user = None

        existing = Player.objects.filter(session=game, user=user).first() if user else None
        if existing is not None:  # an account coming back to its own seat
            if existing.is_kicked:
                raise serializers.ValidationError({"code": "The host removed you from this game."})
            attrs.update(game=game, user=user, player=existing)
            return attrs

        if game.status != GameSession.Status.LOBBY:
            raise serializers.ValidationError({"code": "This game has already started."})
        if game.is_locked:
            raise serializers.ValidationError({"code": "The host has locked this lobby."})
        if Player.objects.filter(session=game, nickname__iexact=attrs["nickname"]).exists():
            raise serializers.ValidationError({"nickname": "That nickname is already taken."})
        attrs.update(game=game, user=user, player=None)
        return attrs

    def save(self) -> Player:
        data = self.validated_data
        self.created = data["player"] is None
        if not self.created:
            return data["player"]
        try:
            with transaction.atomic():
                return Player.objects.create(
                    session=data["game"], nickname=data["nickname"], user=data["user"]
                )
        except IntegrityError:  # two people took the same nickname at the same instant
            raise serializers.ValidationError(
                {"nickname": "That nickname is already taken."}
            ) from None

    def to_representation(self, player: Player) -> dict:
        return {
            "code": player.session.code,
            "player": {"id": player.pk, "nickname": player.nickname},
            "player_token": make_player_token(player),
        }


class GameHistorySerializer(serializers.ModelSerializer):
    """One row of the host's history list. Expects `services.history.finished_games` rows
    (annotated with `question_total`, players prefetched into `standings`)."""

    quiz_title = serializers.CharField(source="quiz.title", read_only=True)
    question_count = serializers.IntegerField(source="question_total", read_only=True)
    player_count = serializers.SerializerMethodField()
    winner = serializers.SerializerMethodField()

    class Meta:
        model = GameSession
        fields = [
            "id",
            "code",
            "quiz_title",
            "question_count",
            "player_count",
            "winner",
            "started_at",
            "ended_at",
        ]
        read_only_fields = fields

    def get_player_count(self, game: GameSession) -> int:
        return len(game.standings)

    def get_winner(self, game: GameSession) -> dict | None:
        if not game.standings:
            return None
        top = game.standings[0]
        return {"nickname": top.nickname, "score": top.score}
