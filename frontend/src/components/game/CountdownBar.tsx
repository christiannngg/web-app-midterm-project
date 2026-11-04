import type { CountdownState } from "@/hooks/useCountdown";

export interface CountdownBarProps {
  remainingMs: number;
  totalMs: number;
  state: CountdownState;
}

// Presentational (dumb) component: props in, JSX out, no data fetching.
export default function CountdownBar({ remainingMs, totalMs, state }: CountdownBarProps) {
  if (state === "idle") return null;
  const share = totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0;
  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div className="countdown" data-state={state}>
      {/* role="timer" is not announced on every tick; the visible number is for sighted users. */}
      <div className="countdown-track" aria-hidden="true">
        <div className="countdown-fill" style={{ width: `${share * 100}%` }} />
      </div>
      <p role="timer" className="countdown-label">
        {state === "expired" ? "Time's up" : `${seconds}s`}
      </p>
    </div>
  );
}
