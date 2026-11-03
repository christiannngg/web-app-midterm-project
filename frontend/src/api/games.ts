import type { Game, JoinGameResponse } from "@/types/api";
import { http } from "./client";

/** Host: open a lobby for one of your published quizzes. */
export async function createGame(quizId: number): Promise<Game> {
  const { data } = await http.post<Game>("/games/", { quiz: quizId });
  return data;
}

/** Public lobby info (title, status, locked) for a join code. */
export async function getGame(code: string): Promise<Game> {
  const { data } = await http.get<Game>(`/games/${code}/`);
  return data;
}

/** Claim a nickname in a lobby. The response's `player_token` is what the socket connects with. */
export async function joinGame(code: string, nickname: string): Promise<JoinGameResponse> {
  const { data } = await http.post<JoinGameResponse>("/games/join/", { code, nickname });
  return data;
}

// TODO (Phase 4): fetchLeaderboard(code)
