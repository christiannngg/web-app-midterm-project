from django.contrib import admin
from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.quizzes.urls")),
    path("api/", include("apps.games.urls")),
]
