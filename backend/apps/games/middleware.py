"""Read the `?token=` query parameter of a WebSocket connection.

Two kinds of token arrive here:
  * a SimpleJWT access token (hosts)  -> `scope["user"]` is the User
  * a signed player token (players)   -> not a JWT, so `scope["user"]` stays anonymous
In both cases the raw string is kept in `scope["token"]`; the consumer decides what it means
for the game being joined (see services/lobby.resolve_identity).
"""
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken


@database_sync_to_async
def _get_user(token: str):
    from django.contrib.auth import get_user_model

    try:
        user_id = AccessToken(token)["user_id"]
        return get_user_model().objects.get(pk=user_id)
    except (TokenError, KeyError, get_user_model().DoesNotExist):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get("query_string", b"").decode())
        token = (query.get("token") or [None])[0]
        scope["user"] = await _get_user(token) if token else AnonymousUser()
        scope["token"] = token
        return await super().__call__(scope, receive, send)
