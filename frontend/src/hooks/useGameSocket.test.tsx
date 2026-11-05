import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeQuestion } from "@/test/fixtures";
import { useGameStore } from "@/store/gameStore";
import { useToastStore } from "@/store/toastStore";
import { backoffDelayMs, useGameSocket } from "./useGameSocket";

/** Stands in for the browser's WebSocket so the test decides when it opens, speaks and dies. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }

  // ---- test controls ----
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  receive(type: string, payload: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) });
  }
  drop(code = 1006) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const latest = () => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error("no socket was opened");
  return socket;
};
const connection = () => useGameStore.getState().connection;
const toasts = () => useToastStore.getState().toasts.map((t) => t.message);

describe("backoffDelayMs", () => {
  it("doubles from 1 s and caps at 15 s", () => {
    const full = () => 1; // top of the jitter range
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoffDelayMs(n, full))).toEqual([
      1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000,
    ]);
  });

  it("jitters between half and all of the delay, so a room of players doesn't reconnect in lockstep", () => {
    expect(backoffDelayMs(2, () => 0)).toBe(2_000);
    expect(backoffDelayMs(2, () => 0.5)).toBe(3_000);
    expect(backoffDelayMs(2, () => 1)).toBe(4_000);
  });
});

describe("useGameSocket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    useToastStore.setState({ toasts: [] });
    useGameStore.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects to the game's own URL with the token", () => {
    renderHook(() => useGameSocket("ABC123", "tok en"));
    expect(latest().url).toBe("ws://ws.test/game/ABC123/?token=tok%20en");
    expect(connection()).toBe("connecting");
    act(() => latest().open());
    expect(connection()).toBe("open");
  });

  it("does not connect without a token", () => {
    renderHook(() => useGameSocket("ABC123", null));
    expect(FakeSocket.instances).toHaveLength(0);
    expect(connection()).toBe("idle");
  });

  it("feeds server messages into the store and ignores junk frames", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    act(() => latest().receive("QUESTION_PUSH", makeQuestion()));
    expect(useGameStore.getState().question?.id).toBe(7);
    act(() => latest().onmessage?.({ data: "{not json" }));
    act(() => latest().receive("MYSTERY", {}));
    expect(useGameStore.getState().question?.id).toBe(7);
  });

  it("send() only works while the socket is open", () => {
    const { result } = renderHook(() => useGameSocket("ABC123", "t"));
    expect(result.current.send({ type: "HOST_NEXT", payload: {} })).toBe(false);
    act(() => latest().open());
    expect(result.current.send({ type: "HOST_NEXT", payload: {} })).toBe(true);
    expect(latest().sent).toContain(JSON.stringify({ type: "HOST_NEXT", payload: {} }));
  });

  it("a dropped connection keeps the question on screen, reconnects after the backoff, and says so", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    act(() => latest().receive("QUESTION_PUSH", makeQuestion()));

    act(() => latest().drop(1006));
    expect(connection()).toBe("reconnecting");
    expect(useGameStore.getState().question?.id).toBe(7); // not wiped: the game stays on screen
    expect(FakeSocket.instances).toHaveLength(1); // still waiting out the backoff

    act(() => {
      vi.advanceTimersByTime(1_000); // first retry waits at most 1 s
    });
    expect(FakeSocket.instances).toHaveLength(2);

    act(() => latest().open());
    expect(connection()).toBe("open");
    expect(toasts()).toContain("Back online.");

    // The server re-sends the current question on every new socket; the store just folds it in.
    act(() => latest().receive("QUESTION_PUSH", makeQuestion({ startedAtMs: 1_000_000 })));
    expect(useGameStore.getState().question?.id).toBe(7);
  });

  it("keeps retrying with growing waits while the network stays down", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    act(() => latest().drop());

    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(connection()).toBe("reconnecting");
      act(() => latest().drop()); // the retry fails too
    }
    expect(FakeSocket.instances).toHaveLength(5);
  });

  it("the browser's online event retries at once instead of waiting out the backoff", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    act(() => latest().drop());
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("the offline event drops a socket that still looks open", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(connection()).toBe("reconnecting");
  });

  it("a connection that goes silent is noticed by the heartbeat", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    const first = latest();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(first.sent.some((f) => f.includes("PING"))).toBe(true);
    // Nothing ever comes back (no PONG): after 25 s of silence it is declared dead.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(connection()).toBe("reconnecting");
  });

  it("a PONG keeps the connection alive", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    for (let i = 0; i < 6; i++) {
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      act(() => latest().receive("PONG", {}));
    }
    expect(connection()).toBe("open");
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("being kicked (4410) is final: no reconnect", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    act(() => latest().drop(4410));
    expect(connection()).toBe("kicked");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it.each([4401, 4403, 4404])("a refusal (%s) is final and keeps the close code", (code) => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().drop(code));
    expect(connection()).toBe("rejected");
    expect(useGameStore.getState().closeCode).toBe(code);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("once the game has finished, a closed socket is the end, not a dropped connection", () => {
    renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    act(() => latest().receive("GAME_END", { leaderboard: [] }));
    act(() => latest().drop(1000));
    expect(connection()).toBe("closed");
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("a host whose token expired gets a fresh one before reconnecting", async () => {
    const refreshToken = vi.fn().mockResolvedValue("fresh-jwt");
    renderHook(() => useGameSocket("ABC123", "old-jwt", { refreshToken }));
    act(() => latest().open());
    act(() => latest().drop(1006));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(refreshToken).toHaveBeenCalledOnce();
    expect(latest().url).toContain("token=fresh-jwt");
  });

  it("unmounting closes the socket and cancels any pending retry", () => {
    const { unmount } = renderHook(() => useGameSocket("ABC123", "t"));
    act(() => latest().open());
    act(() => latest().drop());
    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("switching games starts from a clean store (one game never leaks into the next)", () => {
    const { rerender } = renderHook(({ code }) => useGameSocket(code, "t"), {
      initialProps: { code: "AAAAAA" },
    });
    act(() => latest().open());
    act(() => latest().receive("QUESTION_PUSH", makeQuestion()));
    expect(useGameStore.getState().question).not.toBeNull();

    rerender({ code: "BBBBBB" });
    expect(useGameStore.getState().question).toBeNull();
    expect(latest().url).toContain("/game/BBBBBB/");
  });
});
