from rest_framework.routers import DefaultRouter

router = DefaultRouter()
# TODO: router.register("games", GameSessionViewSet, basename="game")

urlpatterns = router.urls
