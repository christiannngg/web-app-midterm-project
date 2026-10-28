from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated

from .serializers import RegisterSerializer, UserSerializer


class RegisterView(generics.CreateAPIView):
    """POST /api/auth/register/ -> 201 {id, username, role}. Log in afterwards for tokens."""

    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]
    # Ignore any (possibly stale) Authorization header: signing up must never 401 on it.
    authentication_classes: list = []


class MeView(generics.RetrieveAPIView):
    """GET /api/auth/me/ -> the user behind the bearer token."""

    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user
