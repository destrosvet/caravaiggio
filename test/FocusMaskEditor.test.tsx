// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FocusMaskEditor } from "../src/ui/FocusMaskEditor.tsx";
import { priorityDefaults, sampleFocusMask, type PrioritySettings } from "../src/core/priority.ts";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
test("drag paints image coordinates without panning and commits on release; eraser and clear update the overlay", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const put = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: put,
  } as unknown as CanvasRenderingContext2D);
  const changed = vi.fn(), pan = vi.fn();
  function Harness() {
    const [settings, set] = useState<PrioritySettings>({ ...priorityDefaults, enabled: true });
    const [erase, setErase] = useState(false);
    return <div onPointerDown={pan}>
      <button onClick={() => setErase(true)}>Erase</button>
      <button onClick={() => set({ ...priorityDefaults, enabled: true })}>Clear</button>
      <FocusMaskEditor settings={settings} aspect={2} radius={.15} erase={erase} onChange={next => { changed(next); set(next); }} />
    </div>;
  }
  render(<Harness />);
  const canvas = screen.getByLabelText("Paint subject priority mask") as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 200 }) as DOMRect;
  canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn(); canvas.hasPointerCapture = () => true;
  fireEvent.pointerDown(canvas, { button: 0, clientX: 180, clientY: 150 });
  fireEvent.pointerMove(canvas, { clientX: 420, clientY: 150 });
  expect(changed).not.toHaveBeenCalled();
  fireEvent.pointerUp(canvas);
  expect(pan).not.toHaveBeenCalled();
  const painted = changed.mock.lastCall![0] as PrioritySettings;
  expect(painted.focus).toBe(false);
  expect(sampleFocusMask(painted.mask!, .5, .5)).toBeGreaterThan(.99);
  expect(sampleFocusMask(painted.mask!, .5, .9)).toBe(0);
  fireEvent.click(screen.getByText("Erase"));
  fireEvent.pointerDown(canvas, { button: 0, clientX: 300, clientY: 150 });
  fireEvent.pointerUp(canvas);
  expect(sampleFocusMask(changed.mock.lastCall![0].mask, .5, .5)).toBeLessThan(.01);
  fireEvent.click(screen.getByText("Clear"));
  const rgba = put.mock.lastCall![0].data as Uint8ClampedArray;
  expect(rgba.filter((_, i) => i % 4 === 3).every(v => v === 0)).toBe(true);
});
