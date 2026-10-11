import { buildMachineProgram } from "../src/core/machineProgram.ts";
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MachineExport } from "../src/ui/MachineExport.tsx";
import { ProcedureEditor } from "../src/ui/ProcedureEditor.tsx";
import { createProject } from "../src/project/model.ts";
import { defaultProcedure } from "../src/core/machineSettings.ts";
import type { PaintingPlan } from "../src/core/model.ts";
import { saveNativeGcode } from "../src/platform/projectFiles.ts";
vi.mock("../src/platform/projectFiles.ts", () => ({ hasNativeProjectFiles: true, saveNativeGcode: vi.fn(async () => "painting.gcode") }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const plan: PaintingPlan = { formatVersion:1,projectId:"test",operations:[{type:"stroke",points:[{x:10,y:10},{x:80,y:10}],paintId:"cadmium-red",pressure:.5,speedMmPerMin:600,expectedLoadStart:1,expectedLoadEnd:0}] };
const props = () => ({project:createProject(),plan,onBack:vi.fn(),onWorkspace:vi.fn(),onRegenerate:vi.fn()});
test("export defaults to raised dry run and saves a full painting program after switching", async () => {
  render(<MachineExport {...props()} />);
  expect(screen.getByText("Validation passed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Export dry-run G-code"}));
  await waitFor(() => expect(saveNativeGcode).toHaveBeenCalledTimes(1));
  const dry=vi.mocked(saveNativeGcode).mock.calls[0];
  expect(dry[1]).toMatch(/-dry-run.gcode$/);
  for(const z of dry[0].matchAll(/Z(-?[0-9.]+)/g)) expect(Number(z[1])).toBe(15);
  await waitFor(() => expect(screen.getByRole("button",{name:"Export dry-run G-code"}).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("checkbox",{name:/Dry run/}));
  fireEvent.click(screen.getByRole("button",{name:"Export painting G-code"}));
  await waitFor(() => expect(saveNativeGcode).toHaveBeenCalledTimes(2));
  const painting=vi.mocked(saveNativeGcode).mock.calls[1][0];
  expect(painting).toContain("; load");expect(painting).toContain("; clean");expect(painting).toContain("; wipe");expect(painting).toContain("G4 P1.5");expect(painting).toContain("; park");
});
test("missing current plan offers regeneration and invalid geometry blocks saving",()=>{
  const first=props();const view=render(<MachineExport {...first} plan={null} />);
  fireEvent.click(screen.getByRole("button",{name:"Generate strokes →"}));expect(first.onRegenerate).toHaveBeenCalledOnce();
  view.unmount();
  const next=props();next.project={...next.project,workspace:{...next.project.workspace,safeZ:101}};
  render(<MachineExport {...next} />);
  expect(screen.getByRole("alert").textContent).toMatch(/Safe Z/);
  expect(screen.getByRole("button",{name:"Export dry-run G-code"}).hasAttribute("disabled")).toBe(true);
  expect(saveNativeGcode).not.toHaveBeenCalled();
});
test("service editor changes dipping and dwell points, reorders them and flags unsafe clearance",()=>{
  function Harness(){const [value,setValue]=useState(()=>defaultProcedure("paint",15));return <ProcedureEditor value={value} type="paint" safeZ={15} onChange={setValue} />;}
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Point 1 z"),{target:{value:"-4"}});
  fireEvent.change(screen.getByLabelText("Point 1 seconds"),{target:{value:"2"}});
  fireEvent.click(screen.getByRole("button",{name:"+ Point"}));
  expect((screen.getByLabelText("Point 2 z") as HTMLInputElement).value).toBe("-4");
  fireEvent.change(screen.getByLabelText("Point 2 x"),{target:{value:"5"}});
  fireEvent.click(screen.getByRole("button",{name:"Move point 2 up"}));
  expect((screen.getByLabelText("Point 1 x") as HTMLInputElement).value).toBe("5");
  fireEvent.change(screen.getByLabelText("Clearance above rim · Z mm"),{target:{value:"-5"}});
  expect(screen.getByRole("alert").textContent).toContain("below the container clearance");
});

test("export reuses calculated simulation paths and rejects a snapshot after capacity changes", () => {
  const initial=props(), recalculate=vi.fn();
  const capacity=initial.project.strokeSettings.paintLoadLengthMm ?? 120;
  const machinePaths={sourcePlan:plan,workspaceSignature:JSON.stringify(initial.project.workspace),capacity,brushWidth:initial.project.brush.widthMm,program:buildMachineProgram(plan,initial.project.workspace,capacity,initial.project.brush.widthMm)};
  const view=render(<MachineExport {...initial} machinePaths={machinePaths} onRecalculate={recalculate} />);
  expect(screen.getByText("Validation passed")).toBeTruthy();
  view.rerender(<MachineExport {...initial} project={{...initial.project,strokeSettings:{...initial.project.strokeSettings,paintLoadLengthMm:250}}} machinePaths={machinePaths} onRecalculate={recalculate} />);
  expect(screen.queryByRole("button",{name:"Export dry-run G-code"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Recalculate in Simulation →"}));
  expect(recalculate).toHaveBeenCalledOnce();expect(saveNativeGcode).not.toHaveBeenCalled();
});
