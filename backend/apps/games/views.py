from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.accounts.permissions import IsHost

from .models import GameSession
from .serializers import GameCreateSerializer, GameSessionSerializer, JoinSerializer
from .services import lobby


class GameSessionViewSet(
    mixins.CreateModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """/api/games/

    POST   /games/          host only: open a lobby for one of your published quizzes
    POST   /games/join/     anyone: claim a nickname in a lobby, get a player token for the socket
    GET    /games/<code>/   anyone: public lobby info (title, status, locked)
    """

    queryset = GameSession.objects.select_related("quiz")
    lookup_field = "code"
    lookup_value_regex = "[A-Z0-9]{6}"

    def get_permissions(self):
        if self.action == "create":
            return [IsHost()]
        return [AllowAny()]

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
