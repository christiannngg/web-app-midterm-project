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

## Live gameplay (Phase 4)

- `HOST_START` -> `services/timer.py` starts one `GameRunner` asyncio task per game. It loops:
  `open_question` -> `QUESTION_PUSH` -> wait (time limit, everyone answered, or `HOST_NEXT`)
  -> `close_question` -> `SCORE_SYNC` -> pause (`TRIVIA_REVEAL_SECONDS`) -> next, then `GAME_END`.
- Browsers never count down on their own: `useCountdown` computes `startedAtMs + limit - serverNow`
  on every tick, with the clock offset measured from `serverNowMs` in `QUESTION_PUSH`.
- `ANSWER_SUBMIT` -> `services/scoring.submit_answer`: one `transaction.atomic`, player row
  `select_for_update`, one-answer-per-question check, speed-weighted points (50-100 % of the
  question's points), score bumped with `F("score") + n`.
- The runner is process-local: run a single Daphne worker. Phase 5 re-arms it from the DB
  (`current_question_index`, `question_started_at`) after a restart or reconnect.
