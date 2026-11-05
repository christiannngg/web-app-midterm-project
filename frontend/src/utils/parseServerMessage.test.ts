import { describe, expect, it } from "vitest";
import { makeQuestion } from "@/test/fixtures";
import { parseServerMessage } from "./parseServerMessage";

const frame = (type: string, payload: unknown) => JSON.stringify({ type, payload });

describe("parseServerMessage", () => {
  it("parses a well-formed QUESTION_PUSH", () => {
    const question = makeQuestion();
    expect(parseServerMessage(frame("QUESTION_PUSH", question))).toEqual({
      type: "QUESTION_PUSH",
      payload: question,
    });
  });

  it("parses LOBBY_STATE, SCORE_SYNC, GAME_END, YOUR_ANSWER, PONG and ERROR", () => {
    expect(
      parseServerMessage(
        frame("LOBBY_STATE", {
          status: "LOBBY",
          locked: false,
          players: [{ id: 1, nickname: "Ana", score: 0, connected: true }],
        }),
      )?.type,
    ).toBe("LOBBY_STATE");
    expect(
      parseServerMessage(
        frame("SCORE_SYNC", {
          leaderboard: [{ id: 1, nickname: "Ana", score: 10 }],
          correctChoiceId: 70,
          awarded: [{ playerId: 1, points: 10 }],
        }),
      )?.type,
    ).toBe("SCORE_SYNC");
    expect(parseServerMessage(frame("GAME_END", { leaderboard: [] }))?.type).toBe("GAME_END");
    expect(parseServerMessage(frame("YOUR_ANSWER", { questionId: 7, choiceId: 70 }))?.type).toBe(
      "YOUR_ANSWER",
    );
    expect(parseServerMessage(frame("PONG", {}))?.type).toBe("PONG");
    expect(parseServerMessage(frame("ERROR", { code: "x", detail: "y" }))?.type).toBe("ERROR");
  });

  it("allows a SCORE_SYNC with no correct choice (nobody answered the key away)", () => {
    const msg = parseServerMessage(
      frame("SCORE_SYNC", { leaderboard: [], correctChoiceId: null, awarded: [] }),
    );
    expect(msg).not.toBeNull();
  });

  it.each([
    ["not a string", 42],
    ["not JSON", "{oops"],
    ["a JSON array", "[]"],
    ["no payload", JSON.stringify({ type: "PONG" })],
    ["an unknown type", frame("SOMETHING_NEW", {})],
    ["a QUESTION_PUSH missing its choices", frame("QUESTION_PUSH", { ...makeQuestion(), choices: undefined })],
    ["a QUESTION_PUSH with a string time limit", frame("QUESTION_PUSH", { ...makeQuestion(), timeLimitSeconds: "20" })],
    ["a LOBBY_STATE with an unknown status", frame("LOBBY_STATE", { status: "PAUSED", locked: false, players: [] })],
    ["an ANSWER_PROGRESS with NaN-ish numbers", frame("ANSWER_PROGRESS", { answered: "1", total: 2 })],
  ])("returns null for %s", (_label, raw) => {
    expect(parseServerMessage(raw)).toBeNull();
  });
});
