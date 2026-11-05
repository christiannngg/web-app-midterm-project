import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { notify, useToastStore } from "@/store/toastStore";
import Toaster from "./Toaster";

describe("<Toaster>", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it("is a labelled region even when empty", () => {
    render(<Toaster />);
    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
  });

  it("announces errors urgently (alert) and other toasts politely (status)", () => {
    render(<Toaster />);
    notify.error("Can't reach the server.");
    notify.success("Results downloaded.");
    // Zustand updates outside React's batch: wait for the re-render
    return screen.findByRole("alert").then((alert) => {
      expect(alert).toHaveTextContent("Can't reach the server.");
      expect(screen.getByRole("status")).toHaveTextContent("Results downloaded.");
    });
  });

  it("can be dismissed with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    notify.info("Heads up");
    const close = await screen.findByRole("button", { name: "Dismiss notification" });
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByText("Heads up")).not.toBeInTheDocument();
  });
});
