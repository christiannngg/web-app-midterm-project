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
  /** The question on screen. Stays set through the results pause; cleared by GAME_END. */
  question: QuestionPayload | null;
  /** Server clock minus this browser's clock (ms), measured when the question arrived. */
  clockOffsetMs: number;
  /** Players who have answered the open question / players currently connected. */
  answerProgress: { answered: number; total: number } | null;
  /** The question is over and its answer is on screen (between SCORE_SYNC and the next push). */
  revealed: boolean;
  correctChoiceId: number | null;
  /** Points each player earned on the question that just closed, by player id. */
  awarded: Record<number, number>;
  /** The choice this player picked on the current question (players only). */
  myChoiceId: number | null;
  leaderboard: Player[];
  connection: ConnectionState;
  /** WebSocket close code of the last disconnect (4401/4403/4404/4410 mean the server refused us). */
  closeCode: number | null;
  /** Latest ERROR event from the server (e.g. "Wait for at least one player"). */
  lastError: ServerError | null;
  /** Fold one server message into state, so the socket hook only has to dispatch. */
  apply: (msg: ServerMessage) => void;
  /** Remember which choice this player tapped, so the UI can lock in and highlight it. */
  selectChoice: (choiceId: number) => void;
  setConnection: (connection: ConnectionState, closeCode?: number | null) => void;
  clearError: () => void;
  reset: () => void;
}

type DataKeys =
  | "status"
  | "locked"
  | "players"
  | "question"
  | "clockOffsetMs"
  | "answerProgress"
  | "revealed"
  | "correctChoiceId"
  | "awarded"
  | "myChoiceId"
  | "leaderboard"
  | "connection"
  | "closeCode"
  | "lastError";

/** A fresh object each time, so `reset()` never shares array instances with the last game. */
const initialState = (): Pick<GameState, DataKeys> => ({
  status: "LOBBY",
  locked: false,
  players: [],
  question: null,
  clockOffsetMs: 0,
  answerProgress: null,
  revealed: false,
  correctChoiceId: null,
  awarded: {},
  myChoiceId: null,
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
        set({
          status: "IN_PROGRESS",
          question: msg.payload,
          // Measured against the server's own timestamp, so a wrong laptop clock can't
          // make the countdown run fast or slow.
          clockOffsetMs: msg.payload.serverNowMs - Date.now(),
          answerProgress: null,
          revealed: false,
          correctChoiceId: null,
          awarded: {},
          myChoiceId: null,
          lastError: null,
        });
        return;
      case "ANSWER_PROGRESS":
        set({ answerProgress: msg.payload });
        return;
      case "SCORE_SYNC":
        set({
          leaderboard: msg.payload.leaderboard,
          correctChoiceId: msg.payload.correctChoiceId,
          awarded: Object.fromEntries(msg.payload.awarded.map((a) => [a.playerId, a.points])),
          revealed: true,
        });
        return;
      case "GAME_END":
        set({
          status: "FINISHED",
          leaderboard: msg.payload.leaderboard,
          question: null,
          revealed: false,
        });
        return;
      case "YOUR_ANSWER":
        // Reconnect: the server remembers what we picked. Ignore it if it's for another question.
        set((s) =>
          s.question?.id === msg.payload.questionId ? { myChoiceId: msg.payload.choiceId } : {},
        );
        return;
      case "PONG":
        return; // the socket hook only needs to know *something* arrived
      case "ERROR":
        set({ lastError: msg.payload });
        return;
    }
  },

  selectChoice: (choiceId) => set({ myChoiceId: choiceId }),
  setConnection: (connection, closeCode = null) => set({ connection, closeCode }),
  clearError: () => set({ lastError: null }),
  reset: () => set(initialState()),
}));
// Components should subscribe with selectors: useGameStore((s) => s.players)
