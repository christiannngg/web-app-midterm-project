import type { Player, QuestionPayload } from "@/types/ws";

/** A question that opened at `startedAtMs` with the server and this browser agreeing on the time. */
export function makeQuestion(overrides: Partial<QuestionPayload> = {}): QuestionPayload {
  return {
    id: 7,
    text: "What is the capital of France?",
    choices: [
      { id: 70, text: "Paris" },
      { id: 71, text: "Rome" },
      { id: 72, text: "Madrid" },
    ],
    timeLimitSeconds: 20,
    startedAtMs: 1_000_000,
    serverNowMs: 1_000_000,
    index: 0,
    total: 5,
    ...overrides,
  };
}

export function makePlayers(): Player[] {
  return [
    { id: 1, nickname: "Ana", score: 1800 },
    { id: 2, nickname: "Ben", score: 1200 },
    { id: 3, nickname: "Cy", score: 900 },
    { id: 4, nickname: "Dee", score: 300 },
  ];
}
