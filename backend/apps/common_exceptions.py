"""Uniform error envelope so the frontend can parse every error the same way.

    {"code": "<machine_code>", "detail": "<message>", "fields": {"<field>": ["<msg>", ...]}}

`fields` is only present for 400 validation errors. Nested serializer errors are flattened
to dotted paths (e.g. "questions.0.choices.1.text") so each message maps to one input.
Mirrors `ApiErrorBody` in frontend/src/types/api.ts.
"""
import logging

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)

NON_FIELD = "non_field_errors"

_DEFAULT_CODES = {
    status.HTTP_400_BAD_REQUEST: "validation_error",
    status.HTTP_401_UNAUTHORIZED: "not_authenticated",
    status.HTTP_403_FORBIDDEN: "permission_denied",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_429_TOO_MANY_REQUESTS: "throttled",
}


def _flatten(errors, prefix: str = "") -> dict[str, list[str]]:
    """Turn DRF's nested error structure into {"dotted.path": [messages]}."""
    out: dict[str, list[str]] = {}
    if isinstance(errors, dict):
        for key, value in errors.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            for sub_path, msgs in _flatten(value, path).items():
                out.setdefault(sub_path, []).extend(msgs)
    elif isinstance(errors, list):
        if all(isinstance(item, str) for item in errors):
            out[prefix or NON_FIELD] = [str(item) for item in errors]
        else:
            for index, item in enumerate(errors):
                if not item:  # DRF pads valid list items with {}
                    continue
                path = f"{prefix}.{index}" if prefix else str(index)
                for sub_path, msgs in _flatten(item, path).items():
                    out.setdefault(sub_path, []).extend(msgs)
    else:
        out[prefix or NON_FIELD] = [str(errors)]
    return out


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is None:  # unhandled exception -> 500 in the same envelope
        logger.exception("Unhandled error in %s", context.get("view"), exc_info=exc)
        return Response(
            {"code": "server_error", "detail": "Something went wrong on our side."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    data = response.data
    if isinstance(exc, ValidationError):
        response.data = {
            "code": "validation_error",
            "detail": "Please fix the highlighted fields.",
            "fields": _flatten(data),
        }
        return response

    detail = data.get("detail") if isinstance(data, dict) else None
    if detail is None:
        detail = data if isinstance(data, str) else "Request failed."
    code = (
        (data.get("code") if isinstance(data, dict) else None)  # SimpleJWT puts it here
        or getattr(detail, "code", None)
        or _DEFAULT_CODES.get(response.status_code, "error")
    )
    response.data = {"code": str(code), "detail": str(detail)}
    return response
