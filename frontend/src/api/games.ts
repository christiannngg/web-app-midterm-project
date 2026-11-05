import type { Game, JoinGameResponse } from "@/types/api";
import { http } from "./client";

/** Host: open a lobby for one of your published quizzes. */
export async function createGame(quizId: number): Promise<Game> {
  // inline: QuizListPage shows the "publish this quiz first" style messages itself.
  const { data } = await http.post<Game>("/games/", { quiz: quizId }, { inline: true });
  return data;
}

/** Public lobby info (title, status, locked) for a join code. */
export async function getGame(code: string): Promise<Game> {
  // inline: the title is cosmetic, and a bad code already shows up as a refused socket.
  const { data } = await http.get<Game>(`/games/${code}/`, { inline: true });
  return data;
}

/** Claim a nickname in a lobby. The response's `player_token` is what the socket connects with. */
export async function joinGame(code: string, nickname: string): Promise<JoinGameResponse> {
  const { data } = await http.post<JoinGameResponse>(
    "/games/join/",
    { code, nickname },
    { inline: true }, // the join form shows its own errors
  );
  return data;
}

