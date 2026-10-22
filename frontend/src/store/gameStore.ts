import { create } from "zustand";
import type { GameStatus, Player, QuestionPayload } from "@/types/ws";

interface GameState {
  status: GameStatus;
  players: Player[];
  question: QuestionPayload | null;
  leaderboard: Player[];
  // TODO: add `apply(msg: ServerMessage)` reducer so the WS hook only dispatches
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  status: "LOBBY",
  players: [],
  question: null,
  leaderboard: [],
  reset: () => set({ status: "LOBBY", players: [], question: null, leaderboard: [] }),
}));
// Components should subscribe with selectors: useGameStore((s) => s.players)
