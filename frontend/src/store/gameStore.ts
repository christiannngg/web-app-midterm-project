import { create } from "zustand";
import type {
  ConnectionState,
  GameStatus,
  LobbyPlayer,
  Player,
  QuestionPayload,
  ServerMessage,
} from "@/types/ws";

export interface ServerError {
  code: string;
  detail: string;
}

interface GameState {
  status: GameStatus;
  /** Host closed the lobby to new joins. */
  locked: boolean;
  players: LobbyPlayer[];
  question: QuestionPayload | null;
  leaderboard: Player[];
  connection: ConnectionState;
  /** WebSocket close code of the last disconnect (4401/4403/4404/4410 mean the server refused us). */
  closeCode: number | null;
  /** Latest ERROR event from the server (e.g. "Wait for at least one player"). */
  lastError: ServerError | null;
  /** Fold one server message into state, so the socket hook only has to dispatch. */
  apply: (msg: ServerMessage) => void;
  setConnection: (connection: ConnectionState, closeCode?: number | null) => void;
  clearError: () => void;
  reset: () => void;
}

/** A fresh object each time, so `reset()` never shares array instances with the last game. */
const initialState = (): Pick<
  GameState,
  "status" | "locked" | "players" | "question" | "leaderboard" | "connection" | "closeCode" | "lastError"
> => ({
  status: "LOBBY",
  locked: false,
  players: [],
  question: null,
  leaderboard: [],
  connection: "idle",
  closeCode: null,
  lastError: null,
});

export const useGameStore = create<GameState>((set) => ({
  ...initialState(),

  apply: (msg) => {
    switch (msg.type) {
      case "LOBBY_STATE":
        set({
          status: msg.payload.status,
          locked: msg.payload.locked,
          players: msg.payload.players,
        });
        return;
      case "QUESTION_PUSH":
        set({ status: "IN_PROGRESS", question: msg.payload });
        return;
      case "SCORE_SYNC":
        set({ leaderboard: msg.payload.leaderboard });
        return;
      case "GAME_END":
        set({ status: "FINISHED", leaderboard: msg.payload.leaderboard, question: null });
        return;
      case "ERROR":
        set({ lastError: msg.payload });
        return;
    }
  },

  setConnection: (connection, closeCode = null) => set({ connection, closeCode }),
  clearError: () => set({ lastError: null }),
  reset: () => set(initialState()),
}));
// Components should subscribe with selectors: useGameStore((s) => s.players)
