from rest_framework.routers import DefaultRouter

router = DefaultRouter()
# TODO: router.register("quizzes", QuizViewSet, basename="quiz")

urlpatterns = router.urls
