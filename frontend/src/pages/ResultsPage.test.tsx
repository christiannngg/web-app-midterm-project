import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, type AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as historyApi from "@/api/history";
import { useToastStore } from "@/store/toastStore";
import type { GameResults } from "@/types/api";
import * as download from "@/utils/download";
import ResultsPage from "./ResultsPage";

vi.mock("@/api/history");
vi.mock("@/utils/download");

const results: GameResults = {
  code: "ABC123",
  quiz_title: "World capitals",
  started_at: "2026-11-04T20:00:00Z",
  ended_at: "2026-11-04T20:10:00Z",
  player_count: 2,
  question_count: 1,
  standings: [
    { rank: 1, player_id: 1, nickname: "Ana", score: 900, answered_count: 1, correct_count: 1 },
    { rank: 2, player_id: 2, nickname: "Ben", score: 0, answered_count: 1, correct_count: 0 },
  ],
  questions: [
    {
      id: 1,
      number: 1,
      text: "Capital of France?",
      points: 1000,
      time_limit_s: 20,
      answered_count: 2,
      correct_count: 1,
      choices: [
        { id: 1, text: "Paris", is_correct: true, picked_count: 1 },
        { id: 2, text: "Rome", is_correct: false, picked_count: 1 },
      ],
    },
  ],
};

function httpError(status: number): AxiosError {
  const config = { headers: {} } as AxiosError["config"];
  const response = { status, data: {}, statusText: "", headers: {}, config } as AxiosResponse;
  return new AxiosError("failed", "ERR_BAD_REQUEST", config, null, response);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/history/ABC123"]}>
      <Routes>
        <Route path="/history/:code" element={<ResultsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("<ResultsPage>", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("shows the standings and the per-question breakdown", async () => {
    vi.mocked(historyApi.getResults).mockResolvedValue(results);
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(await screen.findByRole("heading", { name: "World capitals", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Final standings" })).toBeInTheDocument();
    expect(screen.getByText(/Capital of France\?/)).toBeInTheDocument();
  });

  it("downloads the CSV and confirms with a toast", async () => {
    const user = userEvent.setup();
    vi.mocked(historyApi.getResults).mockResolvedValue(results);
    const blob = new Blob(["csv"]);
    vi.mocked(historyApi.downloadResultsCsv).mockResolvedValue({ blob, filename: "trivia-ABC123-results.csv" });
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Download CSV" }));
    await waitFor(() => expect(download.saveBlob).toHaveBeenCalledWith(blob, "trivia-ABC123-results.csv"));
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain("Results downloaded.");
  });

  it("a game that isn't yours (404) reads as 'not found'", async () => {
    vi.mocked(historyApi.getResults).mockRejectedValue(httpError(404));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Game not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to game history" })).toHaveAttribute("href", "/history");
  });

  it("a game still being played (409) points back to the live game", async () => {
    vi.mocked(historyApi.getResults).mockRejectedValue(httpError(409));
    renderPage();
    expect(await screen.findByRole("heading", { name: "Game still in progress" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the game" })).toHaveAttribute("href", "/host/ABC123");
  });

  it("any other failure is shown on the page", async () => {
    vi.mocked(historyApi.getResults).mockRejectedValue(httpError(500));
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to game history" })).toBeInTheDocument();
  });
});
