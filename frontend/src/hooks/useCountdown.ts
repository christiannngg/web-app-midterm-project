/**
 * Countdown state machine: idle -> running -> expired (-> idle on next question).
 * TODO: derive remaining time from server `startedAtMs` + `timeLimitSeconds`
 *       (not from local ticks) so late joiners and tab throttling stay in sync.
 */
export type CountdownState = "idle" | "running" | "expired";

export function useCountdown(): { state: CountdownState; remainingMs: number } {
  return { state: "idle", remainingMs: 0 };
}
