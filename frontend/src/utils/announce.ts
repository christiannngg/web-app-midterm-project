import type { CountdownState } from "@/hooks/useCountdown";

/** Seconds-left marks that get spoken, smallest first. */
const WARNING_MARKS = [5, 10] as const;

/**
 * Text for the screen-reader-only live region next to the countdown. The timer itself is not
 * announced on every tick (that would be unusable), so a screen reader hears only two warnings:
 * "10 seconds left" and "Last 5 seconds". The text changes only when a mark is crossed, which
 * is what makes the live region speak. Marks at or above the time limit are skipped, so a short
 * question doesn't open with a warning. Returns "" when nothing should be said.
 */
export function timeWarning(
  state: CountdownState,
  remainingMs: number,
  timeLimitSeconds: number,
): string {
  if (state !== "running") return "";
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const mark = WARNING_MARKS.find((m) => secondsLeft <= m && m < timeLimitSeconds);
  if (mark === undefined) return "";
  return mark === 10 ? "10 seconds left" : "Last 5 seconds";
}
