import type { GameHistoryItem, GameResults, Paginated } from "@/types/api";
import { http } from "./client";

/** The signed-in host's finished games, newest first. The page shows load errors itself. */
export async function listHistory(page = 1): Promise<Paginated<GameHistoryItem>> {
  const { data } = await http.get<Paginated<GameHistoryItem>>("/games/history/", {
    params: { page },
    inline: true,
  });
  return data;
}

/** Standings and a per-question breakdown. A 404 (not your game) is shown by the page. */
export async function getResults(code: string): Promise<GameResults> {
  const { data } = await http.get<GameResults>(`/games/${code}/results/`, { inline: true });
  return data;
}

/** The game as a CSV file (one row per player per question), ready to save. */
export async function downloadResultsCsv(code: string): Promise<{ blob: Blob; filename: string }> {
  const { data } = await http.get<Blob>(`/games/${code}/export/`, { responseType: "blob" });
  return { blob: data, filename: `trivia-${code}-results.csv` };
}
