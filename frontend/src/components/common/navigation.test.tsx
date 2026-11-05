import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import RouteAnnouncer from "./RouteAnnouncer";
import SkipLink from "./SkipLink";

function Shell({ start = "/" }: { start?: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <SkipLink />
      <nav>
        <Link to="/">Home</Link>
        <Link to="/quizzes">Quizzes</Link>
      </nav>
      <Routes>
        <Route path="/" element={<main><h1>Home page</h1></main>} />
        <Route path="/quizzes" element={<main><h1>Quizzes page</h1></main>} />
      </Routes>
      <RouteAnnouncer />
    </MemoryRouter>
  );
}

describe("<SkipLink>", () => {
  it("is the first tab stop and moves focus to the main content", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    await user.tab();
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });
});

describe("<RouteAnnouncer>", () => {
  it("sets the title on load without stealing focus", () => {
    render(<Shell start="/quizzes" />);
    expect(document.title).toBe("My quizzes · Trivia Tournament");
    expect(screen.getByRole("main")).not.toHaveFocus();
  });

  it("on navigation, updates the title and moves focus to the new page", async () => {
    const user = userEvent.setup();
    render(<Shell />);
    expect(document.title).toBe("Join a game · Trivia Tournament");

    await user.click(screen.getByRole("link", { name: "Quizzes" }));

    expect(document.title).toBe("My quizzes · Trivia Tournament");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Quizzes page" })).toBeInTheDocument();
  });
});
