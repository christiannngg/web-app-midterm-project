# Architecture

## Flow

Host (JWT, role=host) -> `POST /api/games/` creates a `GameSession` + join code ->
players open `ws/game/<code>/?token=<jwt>` -> `LOBBY_JOIN` -> host `HOST_START` ->
server timer pushes `QUESTION_PUSH` -> players `ANSWER_SUBMIT` -> atomic scoring ->
`SCORE_SYNC` broadcast -> repeat -> `GAME_END`.

Redis = Channels layer (group per game: `game_<code>`). Postgres = source of truth.
The server owns the clock; clients render a countdown from `startedAtMs`.

## Rubric checklist

| Dimension                        | Where it lives                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Models/migrations/relations, N+1 | `backend/apps/*/models.py`, viewset querysets (`prefetch_related`)                |
| DRF + auth/permissions           | `serializers.py`, `views.py`, `accounts/permissions.py`, SimpleJWT                |
| React/TS, no `any`               | `frontend/src/components`, `types/`, eslint `no-explicit-any`                     |
| State + API client               | `store/*` (Zustand), `api/*` (Axios)                                              |
| Errors/resilience                | `common_exceptions.py`, axios interceptors, `ErrorBoundary`, `transaction.atomic` |
| Organization/Git                 | `/backend` + `/frontend`, `.gitignore`, `.env.example`, small commits             |

## Suggested build order (one commit per step)

1. Models + migrations + admin 2. Auth endpoints 3. Quiz CRUD 4. Game create/join REST
2. Consumer connect/lobby 6. Timer + question push 7. Atomic scoring + SCORE_SYNC
3. Frontend auth + API client 9. Socket hook + store 10. Lobby/Game UIs 11. Error handling, tests, polish
