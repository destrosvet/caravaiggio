// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PaintLoadInput } from "../src/ui/PaintLoadInput.tsx";
afterEach(cleanup);
test("paint capacity can be cleared and typed digit by digit without changing the plan until commit", () => {
  const changed = vi.fn();
  render(<PaintLoadInput value={120} onChange={changed} />);
  const input = screen.getByRole("spinbutton", { name: "Paint load length · mm" }) as HTMLInputElement;
  input.focus();
  for (const value of ["", "2", "25", "250"]) {
    fireEvent.change(input, { target: { value } });
    expect(input.value).toBe(value);
    expect(changed).not.toHaveBeenCalled();
  }
  fireEvent.keyDown(input, { key: "Enter" });
  expect(changed).toHaveBeenCalledExactlyOnceWith(250);
});
test("invalid or cancelled edits retain the last valid capacity and external updates synchronize", () => {
  const changed = vi.fn();
  const view = render(<PaintLoadInput value={120} onChange={changed} />);
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  for (const value of ["", "2", "5001"]) {
    fireEvent.change(input, { target: { value } }); fireEvent.blur(input);
    expect(input.value).toBe("120");
  }
  fireEvent.change(input, { target: { value: "250" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("120");expect(changed).not.toHaveBeenCalled();
  view.rerender(<PaintLoadInput value={300} onChange={changed} />);
  expect(input.value).toBe("300");
});
