# Real-Time Multi-Room Trivia Tournament

Kahoot-style live trivia. Hosts create a lobby, players join with a code, and the
server pushes timed multiple-choice questions to everyone over WebSockets.

**Stack:** Django + DRF + Channels (Daphne) + Redis + Postgres | React + TypeScript (strict) + Vite + Zustand

## Layout
```
backend/    Django project (config/, apps/accounts, apps/quizzes, apps/games)
frontend/   React + TS app (Vite)
docs/       Architecture notes, WS protocol
docker-compose.yml   Postgres + Redis for local dev
```

## Quick start
```bash
cp .env.example .env
docker compose up -d            # Postgres + Redis

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver      # Daphne serves HTTP + WS on :8000

# Frontend (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                     # http://localhost:5173
```

## Checks
```bash
cd backend && ruff check . && pytest
cd frontend && npm run typecheck && npm run lint
```

See `docs/ARCHITECTURE.md` for the data model, WS protocol and a rubric checklist.
