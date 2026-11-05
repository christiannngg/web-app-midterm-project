import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makePlayers, makeQuestion } from "@/test/fixtures";
import CountdownBar from "./CountdownBar";
import Leaderboard from "./Leaderboard";
import Podium from "./Podium";
import QuestionCard from "./QuestionCard";
import TimeAnnouncer from "./TimeAnnouncer";

describe("<CountdownBar>", () => {
  it("renders nothing without a question", () => {
    const { container } = render(<CountdownBar remainingMs={0} totalMs={0} state="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows whole seconds left, rounded up, in a timer", () => {
    render(<CountdownBar remainingMs={4_200} totalMs={20_000} state="running" />);
    expect(screen.getByRole("timer")).toHaveTextContent("5s");
  });

  it("says 'Time's up' once expired", () => {
    render(<CountdownBar remainingMs={0} totalMs={20_000} state="expired" />);
    expect(screen.getByRole("timer")).toHaveTextContent("Time's up");
  });

  it("hides the decorative bar from assistive technology", () => {
    const { container } = render(<CountdownBar remainingMs={10_000} totalMs={20_000} state="running" />);
    expect(container.querySelector(".countdown-track")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector<HTMLElement>(".countdown-fill")?.style.width).toBe("50%");
  });
});

describe("<TimeAnnouncer>", () => {
  it("is a polite, screen-reader-only live region", () => {
    render(<TimeAnnouncer message="10 seconds left" />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("10 seconds left");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveClass("sr-only");
  });
});

describe("<QuestionCard>", () => {
  const question = makeQuestion();

  it("player view: choices are buttons that report the pick", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <QuestionCard question={question} selectedChoiceId={null} correctChoiceId={null} revealed={false} onSelect={onSelect} />,
    );
    expect(screen.getByText("Question 1 of 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Rome/ }));
    expect(onSelect).toHaveBeenCalledWith(71);
  });

  it("locked: nothing can be picked", () => {
    render(
      <QuestionCard question={question} selectedChoiceId={70} correctChoiceId={null} revealed={false} onSelect={() => undefined} locked />,
    );
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.getByRole("button", { name: /Paris/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Locked in")).toBeInTheDocument();
  });

  it("host view (no onSelect): choices are not buttons", () => {
    render(<QuestionCard question={question} selectedChoiceId={null} correctChoiceId={null} revealed={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Paris")).toBeInTheDocument();
  });

  it("reveal marks the right answer and a wrong pick with text, not just colour", () => {
    render(
      <QuestionCard question={question} selectedChoiceId={71} correctChoiceId={70} revealed onSelect={() => undefined} />,
    );
    expect(screen.getByRole("button", { name: /Paris/ })).toHaveTextContent("✓ Correct");
    expect(screen.getByRole("button", { name: /Rome/ })).toHaveTextContent("✗ Your answer");
  });

  it("players get focus on the question when it appears; the host's screen does not", () => {
    const { unmount } = render(
      <QuestionCard question={question} selectedChoiceId={null} correctChoiceId={null} revealed={false} onSelect={() => undefined} />,
    );
    expect(screen.getByRole("heading", { name: question.text })).toHaveFocus();
    unmount();

    render(<QuestionCard question={question} selectedChoiceId={null} correctChoiceId={null} revealed={false} />);
    expect(screen.getByRole("heading", { name: question.text })).not.toHaveFocus();
  });

  it("a re-render of the same question doesn't pull focus back from where the player is", async () => {
    const user = userEvent.setup();
    const props = { selectedChoiceId: null, correctChoiceId: null, revealed: false, onSelect: () => undefined };
    const { rerender } = render(<QuestionCard question={question} {...props} />);
    await user.tab(); // first answer button
    const first = screen.getByRole("button", { name: /Paris/ });
    expect(first).toHaveFocus();
    rerender(<QuestionCard question={{ ...question }} {...props} />);
    expect(first).toHaveFocus();
  });
});

describe("<Leaderboard> and <Podium>", () => {
  it("lists players in order and marks the viewer", () => {
    render(<Leaderboard players={makePlayers()} selfId={2} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Ana");
    expect(rows[1]).toHaveTextContent("Ben (you)");
  });

  it("shows points gained and honours the limit", () => {
    render(<Leaderboard players={makePlayers()} awarded={{ 1: 850 }} limit={2} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/\+850/)).toBeInTheDocument();
  });

  it("renders nothing for an empty leaderboard", () => {
    const { container } = render(<Leaderboard players={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("podium: top three with places for screen readers, everyone else below", () => {
    render(<Podium players={makePlayers()} selfId={1} />);
    const top = screen.getByRole("list", { name: "Top three" });
    expect(top).toHaveTextContent("Ana (you)");
    expect(top).toHaveTextContent("Place 1");
    expect(screen.getByRole("list", { name: "Remaining players" })).toHaveTextContent("Dee");
  });

  it("podium: says so when nobody played", () => {
    render(<Podium players={[]} />);
    expect(screen.getByText("Nobody played this game.")).toBeInTheDocument();
  });
});
