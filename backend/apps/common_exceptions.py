"""Uniform DRF error envelope so the frontend can parse every error the same way.

TODO: wrap DRF's default handler and return
      {"code": "<machine_code>", "detail": "<message>", "fields": {...}}
"""
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    # TODO: reshape response.data into the envelope above
    return response
