// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { WorkspaceEditor } from "../src/ui/WorkspaceEditor.tsx";
import { createProject } from "../src/project/model.ts";
import type { Workspace } from "../src/core/workspace.ts";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("DOMPoint", class {
    constructor(public x: number, public y: number) {}
    matrixTransform(m: { a: number; d: number; e: number; f: number }) { return { x: this.x * m.a + m.e, y: this.y * m.d + m.f }; }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Harness({ changed }: { changed: (workspace: Workspace) => void }) {
  const [project, setProject] = useState(() => createProject());
  return <WorkspaceEditor project={project} onChange={workspace => { changed(workspace); setProject(previous => ({ ...previous, workspace })); }} onBack={() => {}} onNext={() => {}} />;
}
function surfaces() {
  const svg = screen.getByLabelText("Machine workspace in millimetres") as unknown as SVGSVGElement;
  svg.getScreenCTM = () => ({ inverse: () => ({ a: .5, d: .5, e: -10, f: -20 }) }) as unknown as DOMMatrix;
  const zone = screen.getByRole("button", { name: "Select Canvas" });
  zone.setPointerCapture = vi.fn();
  return { svg, zone };
}
const canvasPosition = (changed: ReturnType<typeof vi.fn>) => {
  const zone = (changed.mock.lastCall![0] as Workspace).zones.find(z => z.id === "canvas")!;
  return [zone.x, zone.y];
};

test("drag snaps real millimetres, respects the grip offset and stops after pointer release", () => {
  const changed = vi.fn(); render(<Harness changed={changed} />);
  const { svg, zone } = surfaces();
  fireEvent.pointerDown(zone, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.pointerMove(svg, { clientX: 120, clientY: 140 });
  expect(changed).not.toHaveBeenCalled();
  fireEvent.pointerMove(svg, { clientX: 127, clientY: 157 });
  expect(canvasPosition(changed)).toEqual([50, 60]);
  fireEvent.pointerMove(svg, { clientX: 120, clientY: 140 });
  expect(canvasPosition(changed)).toEqual([50, 50]);
  fireEvent.pointerUp(svg);
  const count = changed.mock.calls.length;
  fireEvent.pointerMove(svg, { clientX: 200, clientY: 200 });
  expect(changed.mock.calls.length).toBe(count);
});

test("Alt and disabled snapping allow precise placement; spacing changes the grid and persists", () => {
  const changed = vi.fn(); const rendered = render(<Harness changed={changed} />);
  const { svg, zone } = surfaces();
  fireEvent.pointerDown(zone, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.pointerMove(svg, { clientX: 127, clientY: 157, altKey: true });
  expect(canvasPosition(changed)).toEqual([53.5, 58.5]);
  fireEvent.pointerCancel(svg);
  fireEvent.change(screen.getByLabelText("Grid spacing"), { target: { value: "5" } });
  expect(svg.querySelector("#workspace-grid")!.getAttribute("width")).toBe("5");
  fireEvent.click(screen.getByLabelText("Snap to grid"));
  fireEvent.pointerDown(zone, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.pointerMove(svg, { clientX: 121, clientY: 141 });
  expect(canvasPosition(changed)).toEqual([54, 59]);
  rendered.unmount(); render(<Harness changed={changed} />);
  expect((screen.getByLabelText("Snap to grid") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("Grid spacing") as HTMLSelectElement).value).toBe("5");
});
