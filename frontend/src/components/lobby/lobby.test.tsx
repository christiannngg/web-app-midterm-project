import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import HostControls from "@/components/host/HostControls";
import { CLOSE_CODE } from "@/types/ws";
import ConnectionBanner from "./ConnectionBanner";
import JoinCode from "./JoinCode";
import JoinForm from "./JoinForm";
import PlayerList from "./PlayerList";

describe("<ConnectionBanner>", () => {
  it("shows nothing when the connection is fine", () => {
    const { container } = render(<ConnectionBanner state="open" closeCode={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reconnecting: explains and offers 'Try now'", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ConnectionBanner state="reconnecting" closeCode={null} onRetry={onRetry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Connection lost");
    await user.click(screen.getByRole("button", { name: "Try now" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each([
    [CLOSE_CODE.NOT_FOUND, /doesn't exist/],
    [CLOSE_CODE.FORBIDDEN, /aren't part of this game/],
    [CLOSE_CODE.UNAUTHORIZED, /isn't valid/],
  ])("rejected (%s) says why, as an alert", (code, text) => {
    render(<ConnectionBanner state="rejected" closeCode={code} />);
    expect(screen.getByRole("alert")).toHaveTextContent(text);
  });
});

describe("<JoinCode>", () => {
  it("reads the code letter by letter to a screen reader", () => {
    render(<JoinCode code="K7M2QX" />);
    expect(screen.getByLabelText("K 7 M 2 Q X")).toHaveTextContent("K7M2QX");
  });
});

describe("<JoinForm>", () => {
  it("upper-cases the code and submits trimmed values", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<JoinForm submitting={false} fieldErrors={{}} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText("Game code"), "k7m2qx");
    await user.type(screen.getByLabelText("Nickname"), "  Ana  ");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(onSubmit).toHaveBeenCalledWith({ code: "K7M2QX", nickname: "Ana" });
  });

  it("prefills the code from the link", () => {
    render(<JoinForm initialCode="abc123" submitting={false} fieldErrors={{}} onSubmit={() => undefined} />);
    expect(screen.getByLabelText("Game code")).toHaveValue("ABC123");
  });

  it("shows field errors next to the inputs and a form error above them", () => {
    render(
      <JoinForm
        submitting={false}
        formError="Can't reach the server."
        fieldErrors={{ nickname: ["That nickname is taken."] }}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByLabelText("Nickname")).toHaveAccessibleDescription("That nickname is taken.");
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("Can't reach the server.");
  });

  it("disables the button while joining", () => {
    render(<JoinForm submitting fieldErrors={{}} onSubmit={() => undefined} />);
    expect(screen.getByRole("button", { name: "Joining…" })).toBeDisabled();
  });
});

describe("<PlayerList>", () => {
  const players = [
    { id: 1, nickname: "Ana", score: 0, connected: true },
    { id: 2, nickname: "Ben", score: 0, connected: false },
  ];

  it("marks offline players with text, and the viewer as (you)", () => {
    render(<PlayerList players={players} selfId={1} />);
    expect(screen.getByRole("list", { name: "Players in this lobby" })).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("host: kick buttons name the player they remove", async () => {
    const user = userEvent.setup();
    const onKick = vi.fn();
    render(<PlayerList players={players} onKick={onKick} />);
    await user.click(screen.getByRole("button", { name: "Kick Ben" }));
    expect(onKick).toHaveBeenCalledWith(players[1]);
  });

  it("invites players to join when empty", () => {
    render(<PlayerList players={[]} />);
    expect(screen.getByText(/No players yet/)).toBeInTheDocument();
  });
});

describe("<HostControls>", () => {
  const base = { locked: false, connectedCount: 2, enabled: true, onToggleLock: () => undefined, onStart: () => undefined };

  it("start needs a connected player and a live host socket", () => {
    const { rerender } = render(<HostControls {...base} connectedCount={0} />);
    expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
    rerender(<HostControls {...base} enabled={false} />);
    expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
    rerender(<HostControls {...base} />);
    expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
  });

  it("lock toggle reports its state and calls back", async () => {
    const user = userEvent.setup();
    const onToggleLock = vi.fn();
    const { rerender } = render(<HostControls {...base} onToggleLock={onToggleLock} />);
    const lock = screen.getByRole("button", { name: "Lock lobby" });
    expect(lock).toHaveAttribute("aria-pressed", "false");
    await user.click(lock);
    expect(onToggleLock).toHaveBeenCalledOnce();
    rerender(<HostControls {...base} locked onToggleLock={onToggleLock} />);
    expect(screen.getByRole("button", { name: "Unlock lobby" })).toHaveAttribute("aria-pressed", "true");
  });
});
