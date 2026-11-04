/** WebSocket protocol — keep in sync with backend/apps/games/schemas.py. */

export type GameStatus = "LOBBY" | "IN_PROGRESS" | "FINISHED";

export interface Player {
  id: number;
  nickname: string;
  score: number;
}

/** A player as the lobby sees them: `connected` is false until their socket joins (or after it drops). */
export interface LobbyPlayer extends Player {
  connected: boolean;
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
  /** Server epoch ms when this message was built; `serverNowMs - Date.now()` is the clock offset. */
  serverNowMs: number;
  index: number;
  total: number;
}

/** Points one player earned on the question that just closed (0 for wrong or no answer). */
export interface Award {
  playerId: number;
  points: number;
}

export interface LobbyStatePayload {
  players: LobbyPlayer[];
  status: GameStatus;
  /** Host closed the lobby to new joins. */
  locked: boolean;
}

// ---- Client -> Server -------------------------------------------------------
export type ClientMessage =
  /** Player: "my socket is open, show me in the lobby". */
  | { type: "LOBBY_JOIN"; payload: Record<string, never> }
  /** Host: ban a player from this game. */
  | { type: "HOST_KICK"; payload: { playerId: number } }
  /** Host: open or close the lobby to new joins. */
  | { type: "HOST_LOCK"; payload: { locked: boolean } }
  | { type: "HOST_START"; payload: Record<string, never> }
  | { type: "ANSWER_SUBMIT"; payload: { questionId: number; choiceId: number } }
  | { type: "HOST_NEXT"; payload: Record<string, never> };

// ---- Server -> Client -------------------------------------------------------
export type ServerMessage =
  | { type: "LOBBY_STATE"; payload: LobbyStatePayload }
  | { type: "QUESTION_PUSH"; payload: QuestionPayload }
  /** After each accepted answer: how many have answered out of how many are connected. */
  | { type: "ANSWER_PROGRESS"; payload: { answered: number; total: number } }
  /** The question closed: reveal the answer and the new standings. */
  | {
      type: "SCORE_SYNC";
      payload: { leaderboard: Player[]; correctChoiceId: number | null; awarded: Award[] };
    }
  | { type: "GAME_END"; payload: { leaderboard: Player[] } }
  | { type: "ERROR"; payload: { code: string; detail: string } };

// ---- Connection -------------------------------------------------------------

/** WebSocket close codes the server uses for a refused or ended connection. */
export const CLOSE_CODE = {
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  NOT_FOUND: 4404,
  KICKED: 4410,
} as const;

/**
 * idle: not connecting (no token yet)   rejected: server refused the handshake (see closeCode)
 * kicked: the host removed this player   closed: dropped or closed normally
 */
export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "rejected" | "kicked";
