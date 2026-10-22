"""Live game state persisted in Postgres. Planned models:

GameSession : quiz FK->Quiz, host FK->User, code (unique 6-char join code, indexed),
              status (LOBBY|IN_PROGRESS|FINISHED), current_question_index, started_at, ended_at
Player      : session FK->GameSession, user FK->User (null for guests), nickname, score
              unique_together (session, nickname)
Answer      : player FK->Player, question FK->Question, choice FK->Choice, answered_at,
              is_correct, points_awarded; unique_together (player, question)

Many-to-Many: GameSession <-> Quiz tournaments, or Player <-> badges (pick one for the rubric).
Atomic scoring: see services/scoring.py (transaction.atomic + select_for_update / F()).
"""
