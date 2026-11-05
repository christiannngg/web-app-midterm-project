import { describe, expect, it } from "vitest";
import { pageTitleFor } from "./pageTitle";

describe("pageTitleFor", () => {
  it.each([
    ["/", "Join a game · Trivia Tournament"],
    ["/login", "Sign in · Trivia Tournament"],
    ["/quizzes", "My quizzes · Trivia Tournament"],
    ["/quizzes/new", "New quiz · Trivia Tournament"],
    ["/quizzes/12/edit", "Edit quiz · Trivia Tournament"],
    ["/history", "Game history · Trivia Tournament"],
    ["/history/K7M2QX", "Results for game K7M2QX · Trivia Tournament"],
    ["/host/K7M2QX", "Hosting game K7M2QX · Trivia Tournament"],
    ["/play/K7M2QX", "Playing game K7M2QX · Trivia Tournament"],
  ])("%s -> %s", (path, title) => {
    expect(pageTitleFor(path)).toBe(title);
  });

  it("ignores a trailing slash", () => {
    expect(pageTitleFor("/quizzes/")).toBe("My quizzes · Trivia Tournament");
  });

  it("calls an unknown path 'Page not found'", () => {
    expect(pageTitleFor("/nope/at/all")).toBe("Page not found · Trivia Tournament");
  });
});
