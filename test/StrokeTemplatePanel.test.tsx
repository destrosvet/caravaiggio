// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { StrokeTemplatePanel } from "../src/ui/StrokeTemplatePanel.tsx";
import { ShadowPaintSelect } from "../src/ui/ShadowPaintSelect.tsx";
import { createProject } from "../src/project/model.ts";
import type { CaravaiggioProject } from "../src/project/model.ts";
import { strokeTemplateStorageKey } from "../src/project/strokeTemplateLibrary.ts";
beforeEach(() => localStorage.clear());
afterEach(cleanup);

test("shadow paint menu shows palette swatches and supports keyboard selection", () => {
  const onChange = vi.fn();
  const paints = [{ id: "red", name: "Color 01", hex: "#ff0000", skipPainting: false }, { id: "green", name: "Color 02", hex: "#008800", skipPainting: false }, { id: "white", name: "Canvas white", hex: "#ffffff", skipPainting: true }];
  const view = render(<ShadowPaintSelect paints={paints} value="auto" onChange={onChange} />);
  const trigger = screen.getByRole("combobox", { name: "Shadow paint" });
  fireEvent.click(trigger);
  const red = screen.getByRole("option", { name: /Color 01/ });
  expect((red.querySelector(".shadow-paint-swatch") as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
  expect(screen.queryByRole("option", { name: /Canvas white/ })).toBeNull();
  fireEvent.keyDown(trigger, { key: "End" }); fireEvent.keyDown(trigger, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith("green");
  expect(screen.queryByRole("listbox")).toBeNull();
  view.rerender(<ShadowPaintSelect paints={paints} value="green" onChange={onChange} />);
  expect((trigger.querySelector(".shadow-paint-swatch") as HTMLElement).style.backgroundColor).toBe("rgb(0, 136, 0)");
  fireEvent.click(trigger); fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
});
function Harness({ changed }: { changed: (project: CaravaiggioProject) => void }) {
  const [project, setProject] = useState(() => createProject("UI test"));
  return <StrokeTemplatePanel project={project} onChange={next => { changed(next); setProject(next); }} />;
}
test("selecting a recipe reveals its parameters; edits and reset affect the project", () => {
  const changed = vi.fn(); render(<Harness changed={changed} />);
  fireEvent.change(screen.getByLabelText("Template"), { target: { value: "flow-curves" } });
  expect(changed.mock.lastCall?.[0].strokeSettings.strategy).toBe("flow-curves");
  fireEvent.change(screen.getByLabelText(/Organic bending/), { target: { value: ".7" } });
  expect(changed.mock.lastCall?.[0].strokeSettings.strategyParameters.bend).toBe(.7);
  fireEvent.click(screen.getByRole("button", { name: "Reset to template" }));
  expect(changed.mock.lastCall?.[0].strokeSettings.strategyParameters.bend).toBeUndefined();
  expect((screen.getByLabelText(/Organic bending/) as HTMLInputElement).value).toBe("0.35");
});
test("a custom recipe is saved and selectable after the panel remounts", () => {
  const changed = vi.fn(); const first = render(<Harness changed={changed} />);
  fireEvent.change(screen.getByLabelText("Template"), { target: { value: "colour-dabs" } });
  fireEvent.change(screen.getByLabelText(/Dab spacing/), { target: { value: "1.7" } });
  fireEvent.change(screen.getByLabelText("Save current settings as"), { target: { value: "My dabs" } });
  fireEvent.click(screen.getByRole("button", { name: "Save new template" }));
  const saved = JSON.parse(localStorage.getItem(strokeTemplateStorageKey)!);
  expect(saved.templates[0].settings.strategyParameters.spacing).toBe(1.7);
  first.unmount(); render(<Harness changed={changed} />);
  fireEvent.change(screen.getByLabelText("Template"), { target: { value: saved.templates[0].id } });
  expect(changed.mock.lastCall?.[0].strokeSettings.strategy).toBe("dabs");
  expect((screen.getByLabelText(/Dab spacing/) as HTMLInputElement).value).toBe("1.7");
});
test("unreadable saved library is reported and is never overwritten", () => {
  localStorage.setItem(strokeTemplateStorageKey, "broken"); render(<Harness changed={vi.fn()} />);
  expect(screen.getByRole("alert").textContent).toContain("will not be overwritten");
  fireEvent.change(screen.getByLabelText("Save current settings as"), { target: { value: "New" } });
  expect((screen.getByRole("button", { name: "Save new template" }) as HTMLButtonElement).disabled).toBe(true);
  expect(localStorage.getItem(strokeTemplateStorageKey)).toBe("broken");
});

test("painting styles use the shared parameter editor without original labels", () => {
  const changed = vi.fn(); render(<Harness changed={changed} />);
  expect((screen.getByLabelText("Template") as HTMLSelectElement).value).toBe("realism");
  expect(screen.getByLabelText(/Organic bending/)).toBeTruthy();
  expect(screen.queryByText(/Original/i)).toBeNull();
  for (const [id, strategy, control] of [
    ["realism", "flow-curves", /Organic bending/],
    ["expressionism", "flow-curves", /Organic bending/],
    ["impressionism", "dabs", /Dab spacing/],
    ["pointillism", "dabs", /Dab spacing/],
    ["abstract", "decorative-lines", /Wave amplitude/],
  ] as const) {
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: id } });
    expect(changed.mock.lastCall?.[0].strokeSettings.strategy).toBe(strategy);
    expect(screen.getByLabelText(control)).toBeTruthy();
  }
});
test("shadow controls edit and save real template settings", () => {
  const changed = vi.fn(); render(<Harness changed={changed} />);
  expect(screen.queryByLabelText(/Shadow strength/)).toBeNull();
  fireEvent.click(screen.getByLabelText("Add shadow strokes"));
  fireEvent.change(screen.getByLabelText(/Shadow strength/), { target: { value: ".7" } });
  fireEvent.click(screen.getByRole("combobox", { name: "Shadow paint" }));
  fireEvent.click(screen.getByRole("option", { name: /Cadmium Red/ }));
  expect(changed.mock.lastCall?.[0].strokeSettings.shadows).toMatchObject({ enabled: true, strength: .7, paintId: "cadmium-red" });
  fireEvent.change(screen.getByLabelText("Save current settings as"), { target: { value: "Portrait shadows" } });
  fireEvent.click(screen.getByRole("button", { name: "Save new template" }));
  const saved = JSON.parse(localStorage.getItem(strokeTemplateStorageKey)!);
  expect(saved.templates[0].settings.shadows).toMatchObject({ enabled: true, strength: .7, paintId: "cadmium-red" });
  fireEvent.change(screen.getByLabelText("Template"), { target: { value: "realism" } });
  expect((screen.getByLabelText("Add shadow strokes") as HTMLInputElement).checked).toBe(false);
});
test("detail priority persists in custom templates and offers a painted editor", () => {
  const changed = vi.fn(); render(<Harness changed={changed} />);
  fireEvent.click(screen.getByLabelText("Prioritise photo details"));
  expect((screen.getByLabelText("Simplify background directions") as HTMLInputElement).checked).toBe(false);
  expect(screen.queryByLabelText(/Simplify quiet background/)).toBeNull();
  fireEvent.click(screen.getByLabelText("Simplify background directions"));
  expect(screen.getByLabelText(/Simplify quiet background/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Simplify background directions"));
  expect(screen.getByRole("button", { name: "Paint a focus region" })).toBeTruthy();
  expect(screen.queryByLabelText(/Focus centre X/)).toBeNull();
  fireEvent.click(screen.getByLabelText("Detect photo details automatically"));
  expect(screen.queryByLabelText(/Detail scale/)).toBeNull();
  expect(screen.getByRole("button", { name: "Paint a focus region" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/Extra detail density/), { target: { value: ".7" } });
  expect(changed.mock.lastCall?.[0].strokeSettings.priority).toMatchObject({ enabled: true, automatic: false, strength: .7 });
  fireEvent.change(screen.getByLabelText("Save current settings as"), { target: { value: "Portrait focus" } });
  fireEvent.click(screen.getByRole("button", { name: "Save new template" }));
  expect(JSON.parse(localStorage.getItem(strokeTemplateStorageKey)!).templates[0].settings.priority).toMatchObject({ enabled: true, automatic: false, strength: .7 });
  fireEvent.change(screen.getByLabelText("Template"), { target: { value: "colour-dabs" } });
  expect(screen.queryByLabelText("Prioritise photo details")).toBeNull();
});
