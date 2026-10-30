from rest_framework import filters, viewsets

from apps.accounts.permissions import IsHost

from .models import Quiz
from .serializers import QuizListSerializer, QuizSerializer


class QuizViewSet(viewsets.ModelViewSet):
    """/api/quizzes/ — a host's own quizzes (list is paginated and searchable).

    * Hosts only (IsHost); someone else's quiz is a 404, never a 403, so ids can't be probed.
    * `?search=` matches title, description and tag names.
    * No PATCH: nested data is replaced as a whole via PUT (the builder always sends it all).
    """

    permission_classes = [IsHost]
    filter_backends = [filters.SearchFilter]
    search_fields = ["title", "description", "tags__name"]
    http_method_names = ["get", "post", "put", "delete", "head", "options"]

    def get_queryset(self):
        quizzes = Quiz.objects.filter(owner=self.request.user)
        if self.action == "list":
            # The library only shows a question count, so skip the choices.
            return quizzes.prefetch_related("tags", "questions")
        return quizzes.prefetch_related("tags", "questions__choices")

    def get_serializer_class(self):
        return QuizListSerializer if self.action == "list" else QuizSerializer

    def perform_create(self, serializer: QuizSerializer) -> None:
        serializer.save(owner=self.request.user)
