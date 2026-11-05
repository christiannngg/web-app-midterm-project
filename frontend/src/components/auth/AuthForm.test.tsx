import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AuthForm from "./AuthForm";

const base = { submitting: false, fieldErrors: {}, onSubmit: () => undefined, onModeChange: () => undefined };

describe("<AuthForm>", () => {
  it("sign-in mode has no role picker", () => {
    render(<AuthForm {...base} mode="login" />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "I want to" })).not.toBeInTheDocument();
  });

  it("register mode offers the role as a labelled radio group and submits the choice", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<AuthForm {...base} mode="register" onSubmit={onSubmit} />);
    expect(screen.getByRole("group", { name: "I want to" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Username"), "ana");
    await user.type(screen.getByLabelText("Password"), "a-long-passphrase");
    await user.click(screen.getByRole("radio", { name: "Play games" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(onSubmit).toHaveBeenCalledWith({ username: "ana", password: "a-long-passphrase", role: "player" });
  });

  it("shows server errors beside their fields and bad credentials as an alert", () => {
    render(
      <AuthForm
        {...base}
        mode="login"
        formError="No active account found."
        fieldErrors={{ username: ["This field is required."] }}
      />,
    );
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription("This field is required.");
    expect(screen.getAllByRole("alert")[0]).toHaveTextContent("No active account found.");
  });

  it("switches between modes", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(<AuthForm {...base} mode="login" onModeChange={onModeChange} />);
    await user.click(screen.getByRole("button", { name: "Create an account" }));
    expect(onModeChange).toHaveBeenCalledWith("register");
  });
});
