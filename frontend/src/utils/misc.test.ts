import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBlob } from "./download";
import { errorsAt, errorsUnder } from "./formErrors";
import { formatDateTime, plural } from "./format";
import { clearPlayerSession, loadPlayerSession, savePlayerSession } from "./playerSession";

describe("format", () => {
  it("pluralises", () => {
    expect(plural(1, "player")).toBe("1 player");
    expect(plural(0, "player")).toBe("0 players");
    expect(plural(2, "entry", "entries")).toBe("2 entries");
  });

  it("shows a dash for a missing or unreadable timestamp", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });

  it("formats a real timestamp", () => {
    expect(formatDateTime("2026-11-04T23:55:00Z")).toMatch(/2026/);
  });
});

describe("formErrors", () => {
  const fields = {
    title: ["Required."],
    "questions.0.text": ["Too long."],
    "questions.0.choices.1.text": ["Blank."],
    "questions.10.text": ["Elsewhere."],
  };

  it("errorsAt matches exactly one path", () => {
    expect(errorsAt(fields, "questions.0.text")).toEqual(["Too long."]);
    expect(errorsAt(fields, "questions.0")).toBeUndefined();
  });

  it("errorsUnder matches a path and its children, but not a longer sibling index", () => {
    expect(errorsUnder(fields, "questions.0")).toEqual(["Too long.", "Blank."]);
    expect(errorsUnder(fields, "questions.1")).toEqual([]);
  });
});

describe("playerSession", () => {
  const session = { token: "t", playerId: 3, nickname: "Ana" };

  it("saves, loads and clears a seat per game code", () => {
    savePlayerSession("ABC123", session);
    expect(loadPlayerSession("ABC123")).toEqual(session);
    expect(loadPlayerSession("ZZZ999")).toBeNull();
    clearPlayerSession("ABC123");
    expect(loadPlayerSession("ABC123")).toBeNull();
  });

  it("ignores stored data of the wrong shape", () => {
    window.sessionStorage.setItem("trivia-player:ABC123", JSON.stringify({ token: 1 }));
    expect(loadPlayerSession("ABC123")).toBeNull();
    window.sessionStorage.setItem("trivia-player:ABC123", "{broken");
    expect(loadPlayerSession("ABC123")).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPlayerSession("ABC123")).toBeNull();
    expect(() => savePlayerSession("ABC123", session)).not.toThrow();
  });
});

describe("saveBlob", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clicks a temporary download link and cleans up", () => {
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    saveBlob(new Blob(["a,b"]), "results.csv");

    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
