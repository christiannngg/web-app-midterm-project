import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { GameHistoryItem, QuestionResult, StandingRow } from "@/types/api";
import HistoryList from "./HistoryList";
import QuestionBreakdown from "./QuestionBreakdown";
import StandingsTable from "./StandingsTable";

const game = (overrides: Partial<GameHistoryItem> = {}): GameHistoryItem => ({
  id: 1,
  code: "ABC123",
  quiz_title: "World capitals",
  question_count: 5,
  player_count: 3,
  winner: { nickname: "Ana", score: 4200 },
  started_at: "2026-11-04T20:00:00Z",
  ended_at: "2026-11-04T20:10:00Z",
  ...overrides,
});

describe("<HistoryList>", () => {
  it("shows the winner and links to the results, with a link name that says which game", () => {
    render(
      <MemoryRouter>
        <HistoryList games={[game()]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("World capitals")).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText(/3 players/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /View results for World capitals, game ABC123/ });
    expect(link).toHaveAttribute("href", "/history/ABC123");
  });

  it("handles a game nobody played", () => {
    render(
      <MemoryRouter>
        <HistoryList games={[game({ winner: null, player_count: 0 })]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Nobody played this game.")).toBeInTheDocument();
  });
});

describe("<StandingsTable>", () => {
  const rows: StandingRow[] = [
    { rank: 1, player_id: 1, nickname: "Ana", score: 4200, answered_count: 5, correct_count: 4 },
    { rank: 2, player_id: 2, nickname: "Ben", score: 3000, answered_count: 4, correct_count: 3 },
  ];

  it("is a real table with column and row headers", () => {
    render(<StandingsTable standings={rows} questionCount={5} />);
    expect(screen.getByRole("table", { name: "Final standings" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Rank",
      "Player",
      "Score",
      "Correct",
    ]);
    const anaRow = screen.getByRole("row", { name: /Ana/ });
    expect(within(anaRow).getByRole("rowheader")).toHaveTextContent("Ana");
    expect(anaRow).toHaveTextContent("4 of 5");
  });

  it("says so when nobody played", () => {
    render(<StandingsTable standings={[]} questionCount={5} />);
    expect(screen.getByText("Nobody played this game.")).toBeInTheDocument();
  });
});

describe("<QuestionBreakdown>", () => {
  const question: QuestionResult = {
    id: 10,
    number: 1,
    text: "Capital of France?",
    points: 1000,
    time_limit_s: 20,
    answered_count: 4,
    correct_count: 3,
    choices: [
      { id: 1, text: "Paris", is_correct: true, picked_count: 3 },
      { id: 2, text: "Rome", is_correct: false, picked_count: 1 },
    ],
  };

  it("shows how many got it right and what each choice drew", () => {
    render(<QuestionBreakdown questions={[question]} />);
    expect(screen.getByRole("heading", { name: /Question 1: Capital of France\?/ })).toBeInTheDocument();
    expect(screen.getByText("3 of 4 players who answered got it right")).toBeInTheDocument();
    expect(screen.getByText("3 picks")).toBeInTheDocument();
    expect(screen.getByText("1 pick")).toBeInTheDocument();
    expect(screen.getByText("Correct answer")).toBeInTheDocument();
  });

  it("copes with a question nobody answered", () => {
    render(<QuestionBreakdown questions={[{ ...question, answered_count: 0, correct_count: 0, choices: question.choices.map((c) => ({ ...c, picked_count: 0 })) }]} />);
    expect(screen.getAllByText("0 picks")).toHaveLength(2);
  });
});
