import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import * as historyApi from "@/api/history";
import type { GameHistoryItem, Paginated } from "@/types/api";
import HistoryPage from "./HistoryPage";

vi.mock("@/api/history");

const item = (n: number): GameHistoryItem => ({
  id: n,
  code: `GAME${String(n).padStart(2, "0")}`,
  quiz_title: `Quiz ${n}`,
  question_count: 5,
  player_count: 3,
  winner: { nickname: "Ana", score: 100 },
  started_at: null,
  ended_at: "2026-11-04T20:10:00Z",
});

const page = (results: GameHistoryItem[], next: string | null = null, previous: string | null = null): Paginated<GameHistoryItem> => ({
  count: results.length,
  next,
  previous,
  results,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>,
  );

describe("<HistoryPage>", () => {
  it("lists finished games", async () => {
    vi.mocked(historyApi.listHistory).mockResolvedValue(page([item(1), item(2)]));
    renderPage();
    expect(await screen.findByText("Quiz 1")).toBeInTheDocument();
    expect(screen.getByText("Quiz 2")).toBeInTheDocument();
  });

  it("explains an empty history", async () => {
    vi.mocked(historyApi.listHistory).mockResolvedValue(page([]));
    renderPage();
    expect(await screen.findByText(/No finished games yet/)).toBeInTheDocument();
  });

  it("pages forward and back", async () => {
    const user = userEvent.setup();
    vi.mocked(historyApi.listHistory)
      .mockResolvedValueOnce(page([item(1)], "next-url"))
      .mockResolvedValueOnce(page([item(2)], null, "prev-url"));
    renderPage();
    await screen.findByText("Quiz 1");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Quiz 2")).toBeInTheDocument();
    expect(historyApi.listHistory).toHaveBeenLastCalledWith(2);
    expect(screen.getByRole("navigation", { name: "History pages" })).toBeInTheDocument();
  });

  it("shows a load failure as an alert", async () => {
    vi.mocked(historyApi.listHistory).mockRejectedValue(new Error("boom"));
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
