import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePlayers, makeQuestion } from "@/test/fixtures";
import { useGameStore } from "./gameStore";

const state = () => useGameStore.getState();

describe("gameStore.apply", () => {
  beforeEach(() => state().reset());

  it("LOBBY_STATE fills the lobby", () => {
    state().apply({
      type: "LOBBY_STATE",
      payload: {
        status: "LOBBY",
        locked: true,
        players: [{ id: 1, nickname: "Ana", score: 0, connected: true }],
      },
    });
    expect(state().locked).toBe(true);
    expect(state().players).toHaveLength(1);
  });

  it("QUESTION_PUSH shows the question, measures the clock offset and clears the last round", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    state().apply({ type: "SCORE_SYNC", payload: { leaderboard: makePlayers(), correctChoiceId: 70, awarded: [{ playerId: 1, points: 500 }] } });
    state().selectChoice(70);

    state().apply({
      type: "QUESTION_PUSH",
      payload: makeQuestion({ serverNowMs: 1_000_250 }),
    });

    expect(state().status).toBe("IN_PROGRESS");
    expect(state().question?.id).toBe(7);
    expect(state().clockOffsetMs).toBe(250);
    expect(state().revealed).toBe(false);
    expect(state().correctChoiceId).toBeNull();
    expect(state().awarded).toEqual({});
    expect(state().myChoiceId).toBeNull();
  });

  it("SCORE_SYNC reveals the answer and indexes awards by player id", () => {
    state().apply({
      type: "SCORE_SYNC",
      payload: {
        leaderboard: makePlayers(),
        correctChoiceId: 70,
        awarded: [
          { playerId: 1, points: 900 },
          { playerId: 2, points: 0 },
        ],
      },
    });
    expect(state().revealed).toBe(true);
    expect(state().correctChoiceId).toBe(70);
    expect(state().awarded).toEqual({ 1: 900, 2: 0 });
    expect(state().leaderboard[0]?.nickname).toBe("Ana");
  });

  it("GAME_END finishes the game and clears the question", () => {
    state().apply({ type: "QUESTION_PUSH", payload: makeQuestion() });
    state().apply({ type: "GAME_END", payload: { leaderboard: makePlayers() } });
    expect(state().status).toBe("FINISHED");
    expect(state().question).toBeNull();
    expect(state().leaderboard).toHaveLength(4);
  });

  it("YOUR_ANSWER restores the pick for the current question only", () => {
    state().apply({ type: "QUESTION_PUSH", payload: makeQuestion({ id: 7 }) });
    state().apply({ type: "YOUR_ANSWER", payload: { questionId: 99, choiceId: 5 } });
    expect(state().myChoiceId).toBeNull();
    state().apply({ type: "YOUR_ANSWER", payload: { questionId: 7, choiceId: 71 } });
    expect(state().myChoiceId).toBe(71);
  });

  it("ANSWER_PROGRESS, ERROR and PONG", () => {
    state().apply({ type: "ANSWER_PROGRESS", payload: { answered: 2, total: 3 } });
    expect(state().answerProgress).toEqual({ answered: 2, total: 3 });
    state().apply({ type: "ERROR", payload: { code: "x", detail: "Nope" } });
    expect(state().lastError?.detail).toBe("Nope");
    state().clearError();
    expect(state().lastError).toBeNull();
    const before = state().status;
    state().apply({ type: "PONG", payload: {} });
    expect(state().status).toBe(before);
  });

  it("a reconnect that re-sends the question keeps the pick already made", () => {
    state().apply({ type: "QUESTION_PUSH", payload: makeQuestion() });
    state().apply({ type: "YOUR_ANSWER", payload: { questionId: 7, choiceId: 70 } });
    expect(state().myChoiceId).toBe(70);
  });

  it("reset gives the next game a clean slate with fresh arrays", () => {
    state().apply({ type: "GAME_END", payload: { leaderboard: makePlayers() } });
    state().setConnection("rejected", 4404);
    state().reset();
    expect(state().status).toBe("LOBBY");
    expect(state().leaderboard).toEqual([]);
    expect(state().connection).toBe("idle");
    expect(state().closeCode).toBeNull();
  });
});
