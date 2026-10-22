from rest_framework.permissions import BasePermission

from .models import User


class IsHost(BasePermission):
    """Role-based guard: only users with role=host."""

    def has_permission(self, request, view) -> bool:
        return bool(
            request.user and request.user.is_authenticated and request.user.role == User.Role.HOST
        )
