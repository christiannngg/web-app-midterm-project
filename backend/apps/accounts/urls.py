from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView

urlpatterns = [
    path("login/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    # TODO: path("register/", RegisterView.as_view()), path("me/", MeView.as_view())
]
