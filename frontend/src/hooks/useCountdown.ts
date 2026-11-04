import { useEffect, useState } from "react";
import type { QuestionPayload } from "@/types/ws";

/**
 * Countdown state machine:  idle -> running -> expired  (and back to running on the next question).
 *   idle     no question on screen
 *   running  the server's deadline hasn't passed
 *   expired  it has: answers are closed
 */
export type CountdownState = "idle" | "running" | "expired";

/** How often the display refreshes. The *value* never depends on it (see remainingMs). */
export const TICK_MS = 100;

/**
 * Time left, computed from the server's `startedAtMs` and this browser's clock offset.
 * Nothing is counted down locally: a throttled background tab or a late join still shows
 * the right number the moment it renders.
 */
export function remainingMs(
  question: Pick<QuestionPayload, "startedAtMs" | "timeLimitSeconds">,
  clockOffsetMs: number,
  nowMs: number = Date.now(),
): number {
  const deadline = question.startedAtMs + question.timeLimitSeconds * 1000;
  return Math.max(0, deadline - (nowMs + clockOffsetMs));
}

export function countdownState(hasQuestion: boolean, remaining: number): CountdownState {
  if (!hasQuestion) return "idle";
  return remaining > 0 ? "running" : "expired";
}

export interface Countdown {
  state: CountdownState;
  remainingMs: number;
  totalMs: number;
}

export function useCountdown(question: QuestionPayload | null, clockOffsetMs: number): Countdown {
  // The state only forces a re-render each tick; the number shown is recomputed from the clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!question) return;
    const id = window.setInterval(() => {
      setTick((t) => t + 1);
      if (remainingMs(question, clockOffsetMs) <= 0) window.clearInterval(id);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [question, clockOffsetMs]);

  const remaining = question ? remainingMs(question, clockOffsetMs) : 0;
  return {
    state: countdownState(question !== null, remaining),
    remainingMs: remaining,
    totalMs: question ? question.timeLimitSeconds * 1000 : 0,
  };
}
