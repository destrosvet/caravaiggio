// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { SimulationViewport } from "../src/ui/SimulationViewport.tsx";
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(480);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test("simulation supports wheel zoom, zoom buttons and reset without changing raster resolution", () => {
  const canvasRef = createRef<HTMLCanvasElement>();
  render(<SimulationViewport canvasRef={canvasRef} width={600} height={600} />);
  const viewport = screen.getByLabelText("Simulation zoom and pan viewport");
  expect(screen.getByText("100%")).toBeTruthy();
  const rasterWidth = canvasRef.current!.width;
  fireEvent.wheel(viewport, { deltaY: -100, clientX: 100, clientY: 100 });
  expect(screen.getByText("115%")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in simulation" }));
  expect(screen.getByText("140%")).toBeTruthy();
  fireEvent.change(screen.getByRole("slider", { name: "Simulation preview zoom" }), { target: { value: "400" } });
  expect(screen.getByText("400%")).toBeTruthy();
  fireEvent.wheel(viewport, { deltaY: -100 });expect(screen.getByText("400%")).toBeTruthy();
  expect(canvasRef.current!.width).toBe(rasterWidth);
  viewport.scrollLeft = 100; viewport.scrollTop = 200;
  fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
  expect(screen.getByText("100%")).toBeTruthy();expect(viewport.scrollLeft).toBe(0);expect(viewport.scrollTop).toBe(0);
});
test("dragging pans and cancelling releases the drag", () => {
  render(<SimulationViewport canvasRef={createRef<HTMLCanvasElement>()} width={600} height={600} />);
  const viewport = screen.getByLabelText("Simulation zoom and pan viewport");
  viewport.setPointerCapture = vi.fn();viewport.scrollLeft = 150;viewport.scrollTop = 200;
  fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(viewport, { clientX: 120, clientY: 130 });
  expect(viewport.scrollLeft).toBe(130);expect(viewport.scrollTop).toBe(170);
  fireEvent.pointerCancel(viewport);expect(viewport.classList.contains("panning")).toBe(false);
  fireEvent.pointerMove(viewport, { clientX: 150, clientY: 150 });
  expect(viewport.scrollLeft).toBe(130);expect(viewport.scrollTop).toBe(170);
});
