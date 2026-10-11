// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Simulation } from "../src/ui/Simulation.tsx";
import { createProject } from "../src/project/model.ts";
import type { PaintingPlan } from "../src/core/model.ts";
import * as planning from "../src/core/machineProgram.ts";
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const plan: PaintingPlan = { formatVersion: 1, projectId: "test", operations: [{ type: "stroke", points: [{ x: 10, y: 20 }, { x: 160, y: 20 }], paintId: "cadmium-red", pressure: .5, speedMmPerMin: 300, expectedLoadStart: 1, expectedLoadEnd: 0 }] };
test("capacity changes keep the previous plan until explicit recalculation and gate playback/export", async () => {
  const build = vi.spyOn(planning, "buildMachineProgram"), next = vi.fn();
  function Harness() {
    const [project, setProject] = useState(() => { const p = createProject(); return { ...p, strokeSettings: { ...p.strokeSettings, paintLoadLengthMm: 50 } }; });
    return <Simulation project={project} plan={plan} onCapacityChange={capacity => setProject(p => ({ ...p, strokeSettings: { ...p.strokeSettings, paintLoadLengthMm: capacity } }))}
      onWorkspaceChange={workspace => setProject(p => ({ ...p, workspace }))} onPaintSimulationChange={paintSimulation => setProject(p => ({ ...p, strokeSettings: { ...p.strokeSettings, paintSimulation } }))}
      onBack={() => {}} onRegenerate={() => {}} onNext={next} />;
  }
  render(<Harness />);
  await screen.findByText("Paint loads");
  expect(screen.getByText("Paint loads").nextElementSibling?.textContent).toBe("3");
  expect(build).toHaveBeenCalledTimes(1);
  const input = screen.getByRole("spinbutton", { name: "Paint load length · mm" });
  fireEvent.change(input, { target: { value: "250" } }); fireEvent.blur(input);
  expect(screen.getByRole("status").textContent).toContain("out of date");
  expect(screen.getByText("Paint loads").nextElementSibling?.textContent).toBe("3");
  expect(build).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Play" }).hasAttribute("disabled")).toBe(true);
  const continueButton = screen.getByRole("button", { name: "Continue to Export →" });
  expect(continueButton.hasAttribute("disabled")).toBe(true);
  fireEvent.click(continueButton); expect(next).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Recalculate machine paths" }));
  await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("up to date"));
  expect(build).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toContain("up to date");
  expect(screen.getByText("Paint loads").nextElementSibling?.textContent).toBe("1");
  expect(continueButton.hasAttribute("disabled")).toBe(false);
  fireEvent.click(continueButton); expect(next).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("checkbox", { name: "Group by colour and shorten travel" }));
  expect(screen.getByRole("status").textContent).toContain("out of date");
  expect(build).toHaveBeenCalledTimes(2);
});

test("optional joining recalculates a shorter continuous plan and reports saved time", async () => {
  const source: PaintingPlan={...plan,operations:Array.from({length:3},(_,i)=>({...plan.operations[0],type:"stroke" as const,points:[{x:10+i*3,y:20},{x:12+i*3,y:20}] as const}))};
  const regionMap={widthPx:300,heightPx:400,paintIds:["cadmium-red"],pixels:new Uint8Array(120000)};
  function Harness() {
    const [project,setProject]=useState(()=>{const p=createProject();return {...p,strokeSettings:{...p.strokeSettings,paintLoadLengthMm:1000},workspace:{...p.workspace,machine:{zMin:-20,zMax:100,paintZMin:0,paintZMax:2,travelSpeed:1500,verticalSpeed:300,optimizeOrder:false,cleanBeforeStart:true}}};});
    return <Simulation project={project} plan={source} regionMap={regionMap} onCapacityChange={()=>{}} onWorkspaceChange={workspace=>setProject(p=>({...p,workspace}))} onPaintSimulationChange={()=>{}} onBack={()=>{}} onRegenerate={()=>{}} onNext={()=>{}} />;
  }
  render(<Harness />);
  await screen.findByText("Paint loads");
  expect(screen.getByText("Strokes").nextElementSibling?.textContent).toBe("3");
  fireEvent.click(screen.getByRole("checkbox",{name:"Connect nearby same-colour strokes"}));
  expect(screen.getByRole("status").textContent).toContain("out of date");
  fireEvent.click(screen.getByRole("button",{name:"Recalculate machine paths"}));
  await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("up to date"));
  expect(screen.getByText("Strokes").nextElementSibling?.textContent).toBe("1");
  expect(screen.getByText(/Connected 2 stroke breaks/)).toBeTruthy();
  expect(screen.getByText("Raising and lowering")).toBeTruthy();
});

test("FluidNC profile edits stay pending until recalculation and feed the exported snapshot", async () => {
  const snapshot=vi.fn();
  function Harness(){const [project,setProject]=useState(createProject);return <Simulation project={project} plan={plan} onCapacityChange={()=>{}} onWorkspaceChange={workspace=>setProject(p=>({...p,workspace}))} onPaintSimulationChange={()=>{}} onBack={()=>{}} onRegenerate={()=>{}} onNext={()=>{}} onPathsCalculated={snapshot}/>;}
  render(<Harness/>);
  await screen.findByText("Paint loads");
  const original=snapshot.mock.lastCall![0].program.timeline.duration;
  fireEvent.click(screen.getByText("FluidNC motion profile"));
  const rate=screen.getByLabelText("X maximum rate · mm/min");
  fireEvent.change(rate,{target:{value:"60"}});
  fireEvent.blur(rate);
  fireEvent.click(screen.getByRole("checkbox",{name:"Include acceleration and axis limits"}));
  expect(screen.getByRole("status").textContent).toContain("out of date");
  expect(snapshot.mock.lastCall![0].program.dynamics).toBeUndefined();
  fireEvent.click(screen.getByRole("button",{name:"Recalculate machine paths"}));
  await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("up to date"));
  const result=snapshot.mock.lastCall![0].program;
  expect(result.dynamics.maxRate.x).toBe(60);
  expect(result.timeline.duration).toBeGreaterThan(original);
  expect(screen.getByRole("status").textContent).toContain("up to date");
  const accel=screen.getByLabelText("Z acceleration · mm/s²");
  fireEvent.change(accel,{target:{value:"0"}});fireEvent.blur(accel);
  expect((accel as HTMLInputElement).value).toBe("30");
  expect(screen.getByRole("status").textContent).toContain("up to date");
});

test("paint usage cards show illustrative quantities and apply calibrated coefficients only on recalculation", async () => {
  function Harness(){const [project,setProject]=useState(createProject);return <Simulation project={project} plan={plan} onCapacityChange={()=>{}} onWorkspaceChange={workspace=>setProject(p=>({...p,workspace}))} onPaintSimulationChange={()=>{}} onBack={()=>{}} onRegenerate={()=>{}} onNext={()=>{}}/>;}
  render(<Harness/>);
  await screen.findByText("Paint loads");
  expect(screen.getByText(/Illustrative coefficients/)).toBeTruthy();
  const name=createProject().palette.find(p=>p.id==="cadmium-red")!.name;
  const card=screen.getByRole("article",{name:name+" consumption"});
  expect(within(card).getByText("0.15 m of painting · 2 loads")).toBeTruthy();
  fireEvent.click(screen.getByText("Calibrate paint consumption"));
  const coefficient=screen.getByLabelText("Paint per metre · ml/m");
  fireEvent.change(coefficient,{target:{value:"2"}});fireEvent.blur(coefficient);
  expect(screen.getByRole("status").textContent).toContain("out of date");
  expect(screen.getByText(/Illustrative coefficients/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Recalculate machine paths"}));
  await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("up to date"));
  expect(within(card).getAllByText("≈ 0.35 ml")).toHaveLength(1);
  expect(screen.getByText(/Using your coefficients/)).toBeTruthy();
});

test("calculation progress appears before initial work and recalculation, disabling duplicate runs",async()=>{
 render(<Simulation project={createProject()} plan={plan} onCapacityChange={()=>{}} onWorkspaceChange={()=>{}} onPaintSimulationChange={()=>{}} onBack={()=>{}} onRegenerate={()=>{}} onNext={()=>{}}/>);
 expect(screen.getByRole("progressbar",{name:"Machine path calculation"}).hasAttribute("value")).toBe(false);
 expect(screen.getByRole("button",{name:"Recalculate machine paths"}).hasAttribute("disabled")).toBe(true);
 await screen.findByText("Paint loads");
 expect(screen.queryByRole("progressbar")).toBeNull();
});
