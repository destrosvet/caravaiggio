// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AiPosterizationControls } from "../src/ui/AiPosterizationControls.tsx";
import { createProject } from "../src/project/model.ts";
afterEach(cleanup);

test("classical remains selected without a model and selecting AI keeps classical settings", () => {
  const settings = createProject().posterization, onChange = vi.fn();
  render(<AiPosterizationControls settings={settings} onChange={onChange} analysis={{ status: "loading" }} onRetry={vi.fn()}/>);
  expect((screen.getByLabelText("Posterization method") as HTMLSelectElement).value).toBe("classic");
  expect(screen.queryByText(/Analysing/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Posterization method"), { target: { value: "sam3" } });
  expect(onChange).toHaveBeenCalledWith({ ...settings, method: "sam3" });
});

test("missing local model is explicit, retry is available and AI controls update independently", () => {
  const onChange = vi.fn(), onRetry = vi.fn();
  const settings = { ...createProject().posterization, method: "sam3" as const };
  render(<AiPosterizationControls settings={settings} onChange={onChange} analysis={{ status: "error", error: "Weights are missing" }} onRetry={onRetry}/>);
  expect(screen.getByRole("alert").textContent).toBe("Weights are missing");
  fireEvent.click(screen.getByRole("button", { name: "Retry AI analysis" })); expect(onRetry).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText(/Background simplification/), { target: { value: "4" } });
  expect(onChange).toHaveBeenCalledWith({ ...settings, ai: { backgroundRadiusMm: 4, detailProtection: .9 } });
  fireEvent.change(screen.getByLabelText("Posterization method"), { target: { value: "classic" } });
  expect(onChange).toHaveBeenCalledWith({ ...settings, method: "classic" });
});

test("ready analysis explains automatic human and animal feature protection", () => {
  render(<AiPosterizationControls settings={{ ...createProject().posterization, method: "sam3" }} onChange={vi.fn()} analysis={{ status: "ready", subjects: 3, details: 25, faces: 3, recognitionDetails: 18, hairDetails:3, accessoryDetails:2 }} onRetry={vi.fn()}/>);
  expect(screen.getByRole("status").textContent).toContain("3 face/head regions");
  expect(screen.getByRole("status").textContent).toContain("3 hair masks · 2 accessory masks");
  expect(screen.getByText(/glasses, scarves, hats/)).toBeTruthy();
  expect(screen.getByText(/Small faces are analysed separately/)).toBeTruthy();
  expect(screen.getByText(/final detail stroke pass in every style/)).toBeTruthy();
});

test("extra shades start disabled and can be selected without changing detail controls", () => {
  const settings = {...createProject().posterization, method: "sam3" as const}, onChange = vi.fn();
  render(<AiPosterizationControls settings={settings} onChange={onChange} analysis={{status:"ready",subjects:1,details:2}} onRetry={vi.fn()}/>);
  const slider = screen.getByLabelText(/Additional face shades/) as HTMLInputElement;
  expect(slider.value).toBe("0");
  fireEvent.change(slider, {target:{value:"4"}});
  expect(onChange).toHaveBeenCalledWith({...settings,ai:{backgroundRadiusMm:3,detailProtection:.9,faceShadeCount:4}});
  expect(screen.getByText(/Each added paint needs a cup/)).toBeTruthy();
});

test("continuous AI painting fills gaps by default and the user can opt out",()=>{
 const settings={...createProject().posterization,method:"sam3" as const},onChange=vi.fn();
 render(<AiPosterizationControls settings={settings} onChange={onChange} analysis={{status:"ready",subjects:1,details:2}} onRetry={vi.fn()}/>);
 const checkbox=screen.getByLabelText("Fill gaps with an underpainting") as HTMLInputElement;
 expect(checkbox.checked).toBe(true);
 fireEvent.click(checkbox);
 expect(onChange).toHaveBeenCalledWith({...settings,ai:{backgroundRadiusMm:3,detailProtection:.9,fillGaps:false}});
});
