/** WebSocket protocol — keep in sync with backend/apps/games/schemas.py. */

export interface Player {
  id: number;
  nickname: string;
  score: number;
}

export interface Choice {
  id: number;
  text: string;
}

export interface QuestionPayload {
  id: number;
  text: string;
  choices: Choice[];
  timeLimitSeconds: number;
  /** Server epoch ms when the question opened; clients derive remaining time from this. */
  startedAtMs: number;
  index: number;
  total: number;
}

// ---- Client -> Server -------------------------------------------------------
export type ClientMessage =
  | { type: "LOBBY_JOIN"; payload: { nickname: string } }
  | { type: "ANSWER_SUBMIT"; payload: { questionId: number; choiceId: number } }
  | { type: "HOST_START"; payload: Record<string, never> }
  | { type: "HOST_NEXT"; payload: Record<string, never> };

// ---- Server -> Client -------------------------------------------------------
export type ServerMessage =
  | { type: "LOBBY_STATE"; payload: { players: Player[]; status: GameStatus } }
  | { type: "QUESTION_PUSH"; payload: QuestionPayload }
  | { type: "SCORE_SYNC"; payload: { leaderboard: Player[]; correctChoiceId: number | null } }
  | { type: "GAME_END"; payload: { leaderboard: Player[] } }
  | { type: "ERROR"; payload: { code: string; detail: string } };

export type GameStatus = "LOBBY" | "IN_PROGRESS" | "FINISHED";
