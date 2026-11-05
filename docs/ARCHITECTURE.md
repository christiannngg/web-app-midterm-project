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
- The runner is process-local: run a single Daphne worker. Phase 5 re-arms it from the DB after a
  restart (see below).

## Resilience and history (Phase 5)

**Reconnect.** `useGameSocket` keeps the game on screen when the socket drops, shows a
"reconnecting" banner and retries with exponential backoff (1 s, 2 s, 4 s ... capped at 15 s, with
jitter). Three things notice a dead link: the close event, the browser's `offline` event, and a
heartbeat (`PING` every 10 s; 25 s with nothing back = dead, because a half-dead connection never
fires a close event). Hosts fetch a still-valid JWT before each attempt (`getValidAccessToken`);
player tokens last the whole lobby. It gives up only when the server refuses the socket
(4401/4403/4404/4410) or the game is over.

**State restore.** Every new socket gets `LOBBY_STATE`, then the events it missed, built from the DB
by `gameplay.restore_snapshot`: `QUESTION_PUSH` (original `startedAtMs`, fresh `serverNowMs`),
`YOUR_ANSWER` (players) and `ANSWER_PROGRESS` while the question is open, or `SCORE_SYNC` while the
results show, or `GAME_END`. The client has no special restore path: it folds these events into the
store like any others. `GameSession.question_closed_at` tells "results showing" apart from "first
question not open yet".

**Server restart.** The first socket to connect to an `IN_PROGRESS` game with no timer calls
`timer.start_runner(code, resume=True)`; the runner reads `gameplay.resume_point` and continues: an
open question keeps the time it had left, a results pause finishes what is left of it. Time the
server spent down counts against the question. Players' `is_connected` flags are not reset by a
crash, so until they rejoin the early-close check may wait for the full time limit.

**Sockets per player.** A reconnecting phone opens a new socket before the server notices the old
one died. The consumer counts open sockets per player, so the old one closing late does not mark a
player who is back online as offline. `answer_progress` counts only connected players' answers.

**Errors.** The axios interceptor (`api/client.ts`) reports failures: 400 with field errors is left
to the form (inline, next to the input); 400 without fields, 403, 404, 429, 5xx and "no response"
become toasts (`store/toastStore.ts`, rendered by `<Toaster>` in an `aria-live` region); a 401 is
retried once after a token refresh, and only a _rejected_ refresh token signs the user out (a network
blip does not). Requests whose caller shows the error itself pass `inline: true`. Render crashes are
caught by `ErrorBoundary` (per page, plus an outer one); unknown URLs hit `NotFoundPage`.

**History.** Finished games are the rows Phase 4 already saves. Host-only endpoints:
`GET /api/games/history/` (paginated), `GET /api/games/<code>/results/` (standings + per-question
breakdown, 409 until finished) and `GET /api/games/<code>/export/` (CSV, one row per player per
question, formulas in guest nicknames defused). Another host's game is a 404. Results read the quiz
live, so deleting a quiz deletes its games, and editing a question changes how old results read.

## Polish (Phase 6)

**Tests.** Backend: `pytest` (in-memory Channels layer, Postgres for the threaded concurrency
tests). Frontend: `npm test` (Vitest + Testing Library, jsdom). The socket hook is tested against a
fake `WebSocket` that the test opens, feeds and kills, so reconnect, backoff, heartbeat and the
refusal codes (4401/4403/4404/4410) are checked without a server. The API client is tested with a
fake axios adapter: which status becomes a toast and which is left to the form, and the
refresh-once-and-replay path on a 401.

**Accessibility.** Beyond labelled inputs, `aria-describedby` errors, live regions and real tables:
a skip link; `RouteAnnouncer` sets the page title and focuses `<main>` on every navigation (a
single-page app never reloads, so a screen reader would not otherwise know the page changed);
`QuestionCard` focuses the question heading for players when a new question arrives (keyed on the
question id, so a reconnect that re-sends the same question does not steal focus);
`TimeAnnouncer` speaks "10 seconds left" and "Last 5 seconds" instead of the timer ticking aloud;
form-control borders and focus rings meet 3:1 contrast; motion is reduced under
`prefers-reduced-motion`.

**Seed data.** `python manage.py seed_demo [--reset]` (see the README). It writes finished games
through the same tables and the same `compute_points` as live play.

## Rubric check (Week 6)

| Dimension                 | Check                                                                                                                                                                                                  | Result   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Backend and DB (20)       | FK, Many-to-Many (`Quiz.tags`) and One-to-One (`PlayerProfile`) are all used; viewset and history querysets use `select_related`/`prefetch_related`, with query-count tests; serializers validate      | Pass     |
| API and auth (20)         | DRF viewsets on `DefaultRouter`; SimpleJWT with refresh; `IsHost` on create/history/results/export; another host's game is a 404                                                                       | Pass     |
| React and TypeScript (20) | strict mode, `no-explicit-any` is an ESLint error and none is used; pages are smart, `components/*` are presentational; every WebSocket frame is parsed into a typed `ServerMessage`                   | Pass     |
| State and API client (15) | components subscribe with selectors (no bare `useXStore()`); every network call lives in `src/api`                                                                                                     | Pass     |
| Errors and UI (15)        | 400/401/403/404/500 each have a message (tested end to end in `api/client.test.ts` and `apps/tests/test_common_exceptions.py`); scoring in `transaction.atomic`; keyboard and screen-reader pass above | Pass     |
| Organization and Git (10) | `/backend` + `/frontend`; `.env` ignored; both `.env.example` files list every variable the code reads; commit history is one commit per phase                                                         | See note |

Note: the roadmap asks for small commits as each step lands; the history so far is one commit per
phase, so splitting the Phase 6 work into several commits (tests, accessibility, seed, docs) would
help that score.
