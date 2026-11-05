import { describe, expect, it } from "vitest";
import { timeWarning } from "./announce";

describe("timeWarning", () => {
  it("says nothing while there is plenty of time", () => {
    expect(timeWarning("running", 15_000, 20)).toBe("");
  });

  it("warns at 10 seconds, then for the last 5", () => {
    expect(timeWarning("running", 10_000, 20)).toBe("10 seconds left");
    expect(timeWarning("running", 9_100, 20)).toBe("10 seconds left");
    expect(timeWarning("running", 5_000, 20)).toBe("Last 5 seconds");
    expect(timeWarning("running", 100, 20)).toBe("Last 5 seconds");
  });

  it("stays the same string inside a band, so the live region only speaks when a mark is crossed", () => {
    expect(timeWarning("running", 9_000, 20)).toBe(timeWarning("running", 6_500, 20));
  });

  it("skips marks that are not below the time limit (no warning the moment a short question opens)", () => {
    expect(timeWarning("running", 8_000, 8)).toBe(""); // 10s mark skipped; 8s left is above 5
    expect(timeWarning("running", 5_000, 8)).toBe("Last 5 seconds");
    expect(timeWarning("running", 5_000, 5)).toBe("");
  });

  it("says nothing before a question or after time is up", () => {
    expect(timeWarning("idle", 0, 20)).toBe("");
    expect(timeWarning("expired", 0, 20)).toBe("");
  });
});
