from django.http import HttpResponse
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.accounts.permissions import IsHost

from .models import GameSession
from .serializers import (
    GameCreateSerializer,
    GameHistorySerializer,
    GameSessionSerializer,
    JoinSerializer,
)
from .services import history, lobby

HOST_ONLY_ACTIONS = {"create", "history", "results", "export"}


class GameNotFinished(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "game_not_finished"
    default_detail = "Results are available once the game has finished."


class GameSessionViewSet(
    mixins.CreateModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """/api/games/

    POST   /games/          host only: open a lobby for one of your published quizzes
    POST   /games/join/     anyone: claim a nickname in a lobby, get a player token for the socket
    GET    /games/<code>/   anyone: public lobby info (title, status, locked)

    Host only, and only for the host's own games (someone else's looks like a missing one):
    GET    /games/history/          paginated list of the host's finished games, newest first
    GET    /games/<code>/results/   standings + per-question breakdown (409 until finished)
    GET    /games/<code>/export/    the same game as a CSV download, one row per answer
    """

    queryset = GameSession.objects.select_related("quiz")
    lookup_field = "code"
    lookup_value_regex = "[A-Z0-9]{6}"

    def get_permissions(self):
        if self.action in HOST_ONLY_ACTIONS:
            return [IsHost()]
        return [AllowAny()]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action in ("results", "export"):
            return queryset.filter(host=self.request.user)
        return queryset

    def get_serializer_class(self):
        if self.action == "create":
            return GameCreateSerializer
        if self.action == "join":
            return JoinSerializer
        return GameSessionSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        game = lobby.create_game(request.user, serializer.validated_data["quiz"])
        return Response(GameSessionSerializer(game).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def join(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        player = serializer.save()
        http_status = status.HTTP_201_CREATED if serializer.created else status.HTTP_200_OK
        return Response(serializer.to_representation(player), status=http_status)

    @action(detail=False, methods=["get"])
    def history(self, request):
        page = self.paginate_queryset(history.finished_games(request.user))
        return self.get_paginated_response(GameHistorySerializer(page, many=True).data)

    @action(detail=True, methods=["get"])
    def results(self, request, code=None):
        return Response(history.build_results(self._finished_game()))

    @action(detail=True, methods=["get"])
    def export(self, request, code=None):
        game = self._finished_game()
        response = HttpResponse(
            "".join(history.csv_lines(game)), content_type="text/csv; charset=utf-8"
        )
        filename = f"trivia-{game.code}-results.csv"
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    def _finished_game(self) -> GameSession:
        game = self.get_object()
        if game.status != GameSession.Status.FINISHED:
            raise GameNotFinished()
        return game
