import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeQuestion } from "@/test/fixtures";
import { countdownState, remainingMs, useCountdown } from "./useCountdown";

describe("remainingMs", () => {
  const q = { startedAtMs: 10_000, timeLimitSeconds: 20 };

  it("counts down from the server's start time", () => {
    expect(remainingMs(q, 0, 10_000)).toBe(20_000);
    expect(remainingMs(q, 0, 25_000)).toBe(5_000);
  });

  it("never goes below zero", () => {
    expect(remainingMs(q, 0, 99_999)).toBe(0);
  });

  it("corrects for a browser clock that is behind or ahead of the server", () => {
    // This laptop is 4 s behind the server: its "now" of 21 000 is really 25 000.
    expect(remainingMs(q, 4_000, 21_000)).toBe(5_000);
    // 4 s ahead: its 29 000 is really 25 000.
    expect(remainingMs(q, -4_000, 29_000)).toBe(5_000);
  });

  it("a late joiner sees the true time left, not a fresh 20 seconds", () => {
    expect(remainingMs(q, 0, 22_000)).toBe(8_000);
  });
});

describe("countdownState", () => {
  it("is idle without a question, running while time is left, expired after", () => {
    expect(countdownState(false, 0)).toBe("idle");
    expect(countdownState(true, 1)).toBe("running");
    expect(countdownState(true, 0)).toBe("expired");
  });
});

describe("useCountdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is idle with no question", () => {
    const { result } = renderHook(() => useCountdown(null, 0));
    expect(result.current).toEqual({ state: "idle", remainingMs: 0, totalMs: 0 });
  });

  it("runs, then expires when the server's deadline passes, then restarts on the next question", () => {
    vi.setSystemTime(1_000_000);
    const first = makeQuestion({ id: 1, startedAtMs: 1_000_000, timeLimitSeconds: 5 });
    const { result, rerender } = renderHook(({ q }) => useCountdown(q, 0), {
      initialProps: { q: first },
    });
    expect(result.current.state).toBe("running");
    expect(result.current.totalMs).toBe(5_000);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.remainingMs).toBe(2_000);

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    expect(result.current.state).toBe("expired");
    expect(result.current.remainingMs).toBe(0);

    rerender({ q: makeQuestion({ id: 2, startedAtMs: Date.now(), timeLimitSeconds: 10 }) });
    expect(result.current.state).toBe("running");
    expect(result.current.remainingMs).toBe(10_000);
  });
});
