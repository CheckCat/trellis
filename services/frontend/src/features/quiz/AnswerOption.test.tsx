import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnswerOption } from "./AnswerOption";

afterEach(() => {
  cleanup();
});

const OPTION = { id: "o1", text: "SELECT 1;" };

describe("AnswerOption", () => {
  it("calls onSelect when clicked in idle state and shows no status/explanation (happy path)", async () => {
    const onSelect = vi.fn();
    render(<AnswerOption option={OPTION} status="idle" disabled={false} onSelect={onSelect} />);

    const button = screen.getByRole("button", { name: "SELECT 1;" });
    expect(button.hasAttribute("disabled")).toBe(false);

    const user = userEvent.setup();
    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders a wrong verdict with its explanation and stays clickable (error path)", () => {
    render(
      <AnswerOption
        option={OPTION}
        status="incorrect"
        explanation="Missing FROM clause."
        disabled={false}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Неверно")).toBeTruthy();
    expect(screen.getByText("Missing FROM clause.")).toBeTruthy();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
  });

  it("disables the button while pending and omits explanation text for a graded-but-unexplained option (edge case)", () => {
    render(<AnswerOption option={OPTION} status="pending" disabled={true} onSelect={vi.fn()} />);

    expect(screen.getByText("Проверяем…")).toBeTruthy();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);

    cleanup();

    // A correct option with no `explanation` (server omits the field when
    // the option itself has none) must not render an empty explanation
    // paragraph.
    render(<AnswerOption option={OPTION} status="correct" disabled={false} onSelect={vi.fn()} />);
    expect(screen.getByText("Верно")).toBeTruthy();
    expect(screen.queryByText("", { selector: ".answer-option-explanation" })).toBeNull();
  });
});
