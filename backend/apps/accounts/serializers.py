from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    """Public shape of the current user. Everything is read-only."""

    class Meta:
        model = User
        fields = ("id", "username", "role")
        read_only_fields = fields


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})
    role = serializers.ChoiceField(choices=User.Role.choices, default=User.Role.PLAYER)

    class Meta:
        model = User
        fields = ("id", "username", "password", "role")
        read_only_fields = ("id",)

    def validate_password(self, value: str) -> str:
        """Field-level pass so password problems show up alongside other field errors."""
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate(self, attrs):
        # Second pass with the username available, so UserAttributeSimilarityValidator works.
        try:
            validate_password(attrs["password"], user=User(username=attrs["username"]))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)
