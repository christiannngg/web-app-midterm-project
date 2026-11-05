import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FormField from "./FormField";

describe("<FormField>", () => {
  it("ties the label to the input", () => {
    render(<FormField label="Username" />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
  });

  it("shows server errors next to the input and links them with aria-describedby", () => {
    render(<FormField label="Username" errors={["Taken.", "Too short."]} />);
    const input = screen.getByLabelText("Username");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const list = screen.getByRole("alert");
    expect(list).toHaveTextContent("Taken.");
    expect(list).toHaveTextContent("Too short.");
    expect(input).toHaveAccessibleDescription("Taken. Too short.");
  });

  it("has no error markup when valid", () => {
    render(<FormField label="Username" errors={[]} />);
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a hidden label available to screen readers", () => {
    render(<FormField label="Choice 1 text" hideLabel />);
    expect(screen.getByLabelText("Choice 1 text")).toBeInTheDocument();
    expect(screen.getByText("Choice 1 text")).toHaveClass("sr-only");
  });
});
