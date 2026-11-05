import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify, useToastStore } from "./toastStore";

const toasts = () => useToastStore.getState().toasts;

describe("toastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("shows a toast and removes it after its time (errors stay longer)", () => {
    notify.success("Saved");
    notify.error("Broke");
    expect(toasts().map((t) => t.message)).toEqual(["Saved", "Broke"]);

    vi.advanceTimersByTime(4_000);
    expect(toasts().map((t) => t.message)).toEqual(["Broke"]);

    vi.advanceTimersByTime(3_000);
    expect(toasts()).toEqual([]);
  });

  it("does not stack copies of the same message", () => {
    notify.error("Can't reach the server.");
    notify.error("Can't reach the server.");
    notify.error("Can't reach the server.");
    expect(toasts()).toHaveLength(1);
  });

  it("allows the same text again once the first one is gone", () => {
    notify.info("Hi");
    vi.advanceTimersByTime(4_000);
    notify.info("Hi");
    expect(toasts()).toHaveLength(1);
  });

  it("keeps at most four on screen, dropping the oldest", () => {
    for (const n of [1, 2, 3, 4, 5]) notify.info(`Message ${n}`);
    expect(toasts().map((t) => t.message)).toEqual(["Message 2", "Message 3", "Message 4", "Message 5"]);
  });

  it("dismiss removes one toast and its timer", () => {
    notify.info("A");
    notify.info("B");
    const first = toasts()[0];
    expect(first).toBeDefined();
    useToastStore.getState().dismiss(first?.id ?? -1);
    expect(toasts().map((t) => t.message)).toEqual(["B"]);
    vi.advanceTimersByTime(10_000);
    expect(toasts()).toEqual([]);
  });
});
