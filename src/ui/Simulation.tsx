import {runCalculation} from "../platform/runCalculation.ts";
import {CalculationProgress} from "./CalculationProgress.tsx";
import { PaintUsagePanel } from "./PaintUsagePanel.tsx";
import { MotionDynamicsControls } from "./MotionDynamicsControls.tsx";
import type { ColorRegionMap } from "../core/strokes.ts";
import { SimulationViewport } from "./SimulationViewport.tsx";
import { PaintLoadInput } from "./PaintLoadInput.tsx";
import { type MachineProgram, type MachinePlanSnapshot } from "../core/machineProgram.ts";
import { defaultMachineSettings } from "../core/machineSettings.ts";
import type { Workspace } from "../core/workspace.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PaintingPlan } from "../core/model.ts";
import { simulationPosition, simulationProgress, type SimulationEvent } from "../core/simulation.ts";
import { syncWorkspace } from "../core/workspace.ts";
import type { CaravaiggioProject } from "../project/model.ts";
import { PaintRaster, paintSimulationDefaults, paintPreviewLongestEdge } from "../core/paintRaster.ts";
import { PaintSimulationControls } from "./StrokeTemplatePanel.tsx";
import type { PaintSimulationSettings } from "../core/paintRaster.ts";
type Props = { project: CaravaiggioProject; regionMap?: ColorRegionMap; plan: PaintingPlan | null; onWorkspaceChange: (workspace: Workspace) => void; onCapacityChange: (capacity: number) => void; onPaintSimulationChange: (settings: PaintSimulationSettings) => void; onBack: () => void; onRegenerate: () => void; onNext: () => void; onPathsCalculated?: (snapshot: MachinePlanSnapshot) => void };
const clock = (seconds: number) => seconds >= 3600 ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${Math.floor(seconds) % 60}s` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function Simulation({ project, regionMap, plan, onWorkspaceChange, onCapacityChange, onPaintSimulationChange, onBack, onRegenerate, onNext, onPathsCalculated }: Props) {
  const currentWorkspace = useMemo(() => syncWorkspace(project.workspace, project.canvas, project.palette), [project.workspace, project.canvas, project.palette]);
  const machine = currentWorkspace.machine ?? defaultMachineSettings;
  const inputs = useMemo(() => ({ plan, workspace: currentWorkspace, capacity: project.strokeSettings.paintLoadLengthMm ?? 120, brushWidth: project.brush.widthMm, regionMap }), [plan, currentWorkspace, project.strokeSettings.paintLoadLengthMm, project.brush.widthMm, regionMap]);
  const [requestedInputs,setRequestedInputs]=useState(inputs),[calculationRevision,setCalculationRevision]=useState(0);
  const [calculated,setCalculated]=useState<{inputs:typeof inputs;program:MachineProgram}|null>(null);
  const [pathProgress,setPathProgress]=useState<string|null>("Preparing machine path calculation…"),[pathError,setPathError]=useState("");
  const appliedInputs=calculated?.inputs??requestedInputs;
  const program=calculated?.program??null;
  const pathsStale=inputs!==appliedInputs || pathProgress!==null || !!pathError || !program;
  const workspace=appliedInputs.workspace;
  const recalculate=()=>{setRequestedInputs(inputs);setCalculationRevision(value=>value+1);};
  useEffect(()=>{
    if(!requestedInputs.plan){setPathProgress(null);return;}
    const controller=new AbortController();setPathProgress("Preparing machine path calculation…");setPathError("");
    void runCalculation<"paths">({kind:"paths",plan:requestedInputs.plan,workspace:requestedInputs.workspace,capacity:requestedInputs.capacity,brushWidth:requestedInputs.brushWidth,regionMap:requestedInputs.regionMap},setPathProgress,controller.signal).then(program=>{
      if(controller.signal.aborted)return;
      setCalculated({inputs:requestedInputs,program});setPathProgress(null);
    }).catch(error=>{if(!controller.signal.aborted){setPathError(error instanceof Error?error.message:"Machine path calculation failed.");setPathProgress(null);}});
    return ()=>controller.abort();
  },[requestedInputs,calculationRevision]);
  const timeline = program?.timeline ?? null;
  const timeBreakdown = useMemo(() => {
    const result = { painting: 0, travel: 0, lifting: 0, loading: 0, cleaning: 0 };
    for (const event of timeline?.events ?? []) {
      const key = event.type === "stroke" ? "painting" : event.type === "load" ? "loading" : event.type === "clean" || event.type === "wipe" ? "cleaning" : event.from.x === event.to.x && event.from.y === event.to.y ? "lifting" : "travel";
      result[key] += event.end - event.start;
    }
    return result;
  }, [timeline]);
  useEffect(() => {
    if (program && appliedInputs.plan) onPathsCalculated?.({ sourcePlan: appliedInputs.plan, workspaceSignature: JSON.stringify(appliedInputs.workspace), capacity: appliedInputs.capacity, brushWidth: appliedInputs.brushWidth, program });
  }, [program, appliedInputs, onPathsCalculated]);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(50), [showTravel, setShowTravel] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const paintLayer = useRef<{ canvas: HTMLCanvasElement; raster: PaintRaster; index: number; time: number; timeline: typeof timeline; settings: typeof project.strokeSettings.paintSimulation } | null>(null);
  useEffect(() => { setTime(0); setPlaying(false); paintLayer.current = null; }, [timeline]);
  useEffect(() => {
    if (!playing || !timeline || pathsStale) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - previous) / 1000; previous = now;
      setTime(current => Math.min(timeline.duration, current + Math.min(elapsed, 0.1) * speed));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, timeline, pathsStale]);
  useEffect(() => { if (timeline && time >= timeline.duration) setPlaying(false); }, [time, timeline]);
  useEffect(() => { if (pathsStale) setPlaying(false); }, [pathsStale]);
  const activeIndex = useMemo(() => {
    if (!timeline) return -1;
    let low = 0, high = timeline.events.length;
    while (low < high) { const mid = (low + high) >> 1; if (timeline.events[mid].end <= time) low = mid + 1; else high = mid; }
    return Math.min(low, timeline.events.length - 1);
  }, [time, timeline]);
  const active = timeline?.events[activeIndex];
  useEffect(() => {
    const surface = canvas.current, context = surface?.getContext("2d");
    if (!surface || !context || !timeline) return;
    const scale = 900 / Math.max(workspace.width, workspace.height);
    const width = Math.ceil(workspace.width * scale), height = Math.ceil(workspace.height * scale);
    if (surface.width !== width || surface.height !== height) { surface.width = width; surface.height = height; paintLayer.current = null; }
    const canvasZone = workspace.zones.find(zone => zone.type === "canvas")!;
    if (!paintLayer.current || paintLayer.current.timeline !== timeline || time < paintLayer.current.time || paintLayer.current.settings !== project.strokeSettings.paintSimulation) {
      const layer = document.createElement("canvas");
      const rasterScale = paintPreviewLongestEdge / Math.max(canvasZone.width, canvasZone.height);
      layer.width = Math.max(1, Math.round(canvasZone.width * rasterScale)); layer.height = Math.max(1, Math.round(canvasZone.height * rasterScale));
      const raster = new PaintRaster(layer.width, layer.height, project.canvas, project.brush, project.palette,
        project.strokeSettings.paintSimulation ?? paintSimulationDefaults, project.palette.find(p => p.skipPainting)?.hex ?? "#eee8da");
      paintLayer.current = { canvas: layer, raster, index: 0, time: 0, timeline, settings: project.strokeSettings.paintSimulation };
    }
    const layer = paintLayer.current;
    const draw = (raster: PaintRaster, event: SimulationEvent, until: number) => {
      if (event.type === "load" && event.paintId) raster.load(event.paintId);
      if (event.type === "clean") raster.clean();
      if (event.type !== "stroke" || !event.paintId) return;
      const end = simulationPosition(event, until);
      const fraction = simulationProgress(event,until);
      raster.stroke({ x: event.from.x - canvasZone.x, y: event.from.y - canvasZone.y }, { x: end.x - canvasZone.x, y: end.y - canvasZone.y }, event.paintId,
        event.pressure ?? .5, event.loadStart, event.loadStart + (event.loadEnd - event.loadStart) * fraction, event.start, Math.min(event.end, until));
    };
    while (layer.index < timeline.events.length && timeline.events[layer.index].end <= time) { draw(layer.raster, timeline.events[layer.index], time); layer.index++; }
    layer.time = time;
    context.fillStyle = "#181916"; context.fillRect(0, 0, width, height);
    context.strokeStyle = "#ffffff12"; context.lineWidth = 1;
    for (let x = 0; x < workspace.width; x += 25) { context.beginPath(); context.moveTo(x * scale, 0); context.lineTo(x * scale, height); context.stroke(); }
    for (let y = 0; y < workspace.height; y += 25) { context.beginPath(); context.moveTo(0, y * scale); context.lineTo(width, y * scale); context.stroke(); }
    for (const zone of workspace.zones) {
      context.fillStyle = zone.type === "canvas" ? project.palette.find(color => color.skipPainting)?.hex ?? "#eee8da" : zone.type === "paint" ? project.palette.find(color => color.id === zone.paintId)?.hex ?? "#777" : zone.type === "water" ? "#367eaa" : zone.type === "forbidden" ? "#763730" : zone.type === "wipe" ? "#827266" : "#4a6451";
      context.fillRect(zone.x * scale, zone.y * scale, zone.width * scale, zone.height * scale);
      if (zone.type !== "canvas") { context.fillStyle = "#fff"; context.font = "11px sans-serif"; context.fillText(zone.name, zone.x * scale, zone.y * scale - 4); }
    }
    const visible = active?.type === "stroke" ? layer.raster.clone() : layer.raster;
    if (active?.type === "stroke") draw(visible, active, time);
    layer.canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(visible.rgba), visible.width, visible.height), 0, 0);
    context.drawImage(layer.canvas, canvasZone.x * scale, canvasZone.y * scale, canvasZone.width * scale, canvasZone.height * scale);
    if (showTravel) {
      context.save(); context.strokeStyle = "#e7bf7266"; context.lineWidth = 1; context.setLineDash([4, 4]);
      for (let index = 0; index <= activeIndex; index++) { const event = timeline.events[index]; if (event.type !== "move") continue; const end = simulationPosition(event, time); context.beginPath(); context.moveTo(event.from.x * scale, event.from.y * scale); context.lineTo(end.x * scale, end.y * scale); context.stroke(); }
      context.restore();
    }
    if (active) { const point = simulationPosition(active, time); context.strokeStyle = active.type === "stroke" ? "#fff" : "#e7bf72"; context.lineWidth = 2; context.beginPath(); context.arc(point.x * scale, point.y * scale, Math.max(5, project.brush.widthMm * scale / 2), 0, Math.PI * 2); context.stroke(); }
  }, [time, timeline, workspace, project.palette, project.brush, project.canvas, project.strokeSettings.paintSimulation, showTravel, active, activeIndex]);
  if (!plan) return <section className="planned-step"><p className="eyebrow">Step 05 · Simulation</p><h1>Generate the current strokes first.</h1><p>Image, palette or brush settings have changed, or no strokes have been generated.</p><button className="flow-next" onClick={onRegenerate}>Generate strokes →</button></section>;
  if (!timeline) return <section className="planned-step" aria-busy={!!pathProgress}><h1>Calculate the machine paths.</h1><CalculationProgress stage={pathProgress} label="Machine path calculation"/>{pathError && <p role="alert">{pathError}</p>}<button className="flow-next" disabled={!!pathProgress} onClick={recalculate}>Recalculate machine paths</button><button className="flow-back" onClick={onBack}>← Workspace</button></section>;
  const activeZ = active && "z" in active.from && "z" in active.to ? Number(active.from.z) + (Number(active.to.z) - Number(active.from.z)) * simulationProgress(active,time) : null;
  const load = active ? active.loadStart + (active.loadEnd - active.loadStart) * simulationProgress(active,time) : 0;
  return <section><div className="intro"><p className="eyebrow">Step 05 · Simulation</p><h1>Watch the painting process.</h1><p>Playback follows the exact XYZ program used by Export, including dipping, washing, wiping and safe lifts. {program?.dynamics ? "Timing includes axis limits, acceleration, braking and corner slowdown." : "Timing is a constant-speed estimate. Enable the FluidNC motion profile for acceleration and axis limits."}</p></div>
    <CalculationProgress stage={pathProgress} label="Machine path calculation"/>{pathError && <p role="alert">{pathError}</p>}
    <div className="simulation-layout"><div className="simulation-preview"><SimulationViewport canvasRef={canvas} width={workspace.width} height={workspace.height} headerAction={<button type="button" className="template-action template-action-primary preview-header-action" disabled={!pathsStale || !!pathProgress} onClick={recalculate}>Recalculate machine paths</button>} />
      <div className="simulation-controls"><button disabled={pathsStale || !!timeline.issues.length || !timeline.strokes} onClick={() => { if (time >= timeline.duration) setTime(0); setPlaying(value => !value); }}>{playing ? "Pause" : "Play"}</button><button onClick={() => { setPlaying(false); setTime(0); }}>Restart</button><button disabled={pathsStale || !!timeline.issues.length} onClick={() => { setPlaying(false); setTime(timeline.duration); }}>Show result</button><label>Speed<select value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[1, 10, 50, 200].map(value => <option key={value} value={value}>{value}×</option>)}</select></label><label><input type="checkbox" checked={showTravel} onChange={event => setShowTravel(event.target.checked)} /> Travel paths</label></div>
      <input className="simulation-timeline" aria-label="Simulation time" type="range" min="0" max={timeline.duration} step="0.01" value={time} disabled={pathsStale || !!timeline.issues.length} onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }} /><p className="workspace-caption">{clock(time)} / {clock(timeline.duration)} · {timeline.duration ? Math.round(time / timeline.duration * 100) : 0}%</p>
      <section className="simulation-report" aria-label="Simulation status and statistics">
        <div className="simulation-current-operation">
          <div><p className="eyebrow">Current operation</p><strong>{time >= timeline.duration ? "Finished" : active?.type ?? "Ready"}</strong><p>{project.palette.find(color => color.id === active?.paintId)?.name ?? "Brush"}</p></div>
          {activeZ !== null && <p>Machine Z · {activeZ.toFixed(2)} mm</p>}
          <label>Paint load <meter min="0" max="1" value={load} /> {Math.round(load * 100)}%</label>
        </div>
        <dl className="simulation-metrics">{[
          ["Estimated time", clock(timeline.duration)],
          ["Painting", clock(timeBreakdown.painting)],
          ["Raised XY travel", clock(timeBreakdown.travel)],
          ["Raising and lowering", clock(timeBreakdown.lifting)],
          ["Paint loading", clock(timeBreakdown.loading)],
          ["Washing and wiping", clock(timeBreakdown.cleaning)],
          ["Strokes", timeline.strokes],
          ["Paint loads", timeline.loads],
          ["Cleaning cycles", timeline.cleans],
          ["Painting distance", (timeline.paintDistance / 1000).toFixed(2) + " m"],
          ["Travel distance", (timeline.travelDistance / 1000).toFixed(2) + " m"],
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {program?.optimization && <p className="workspace-caption">{program.optimization.rejected ? "Connections did not improve total time; retained the original paths." : "Connected " + program.optimization.joins + " stroke breaks · Saved " + clock(program.optimization.savedSeconds) + " · Added " + program.optimization.addedPaintingMm.toFixed(1) + " mm of painting"}</p>}
        <p className="workspace-caption">Canvas travel Z {appliedInputs.workspace.machine?.canvasTravelZ ?? workspace.safeZ} mm · Travel {appliedInputs.workspace.machine?.travelSpeed ?? defaultMachineSettings.travelSpeed} mm/min · Service sequences from Workspace</p>
        <PaintUsagePanel timeline={timeline} palette={project.palette} settings={appliedInputs.workspace.machine?.paintUsage} editingSettings={machine.paintUsage} brushWidth={appliedInputs.brushWidth} stale={pathsStale} onChange={paintUsage=>onWorkspaceChange({...currentWorkspace,machine:{...machine,paintUsage}})}/>
      </section>
    </div><aside className="simulation-settings"><label className="simulation-order-toggle"><input type="checkbox" checked={machine.optimizeOrder} onChange={event => onWorkspaceChange({ ...currentWorkspace, machine: { ...machine, optimizeOrder: event.target.checked } })} /> Group by colour and shorten travel</label>
      <label className="simulation-order-toggle"><input type="checkbox" checked={machine.joinStrokes ?? false} disabled={!regionMap} onChange={event => onWorkspaceChange({ ...currentWorkspace, machine: { ...machine, joinStrokes: event.target.checked } })} /> Connect nearby same-colour strokes</label>
      <p className="workspace-caption">Connections add painted lines inside the same target colour. This can change a dotted texture. Different colours, unpainted regions, incompatible pressure and shadow layers stay separate.</p>
      {machine.joinStrokes && <label className="simulation-capacity">Maximum connection gap · {(machine.joinGapMm ?? project.brush.widthMm * .75).toFixed(1)} mm<input type="range" min="0" max={Math.min(50, project.brush.widthMm * 2)} step="0.1" value={machine.joinGapMm ?? project.brush.widthMm * .75} onChange={event => onWorkspaceChange({ ...currentWorkspace, machine: { ...machine, joinGapMm: Number(event.target.value) } })} /></label>}
      <MotionDynamicsControls value={machine.dynamics} onChange={dynamics=>onWorkspaceChange({...currentWorkspace,machine:{...machine,dynamics}})}/>
      <PaintLoadInput value={project.strokeSettings.paintLoadLengthMm ?? 120} onChange={onCapacityChange} />
      <p className="workspace-caption">Painting distance on one load, accumulated across strokes. Raised travel does not consume paint. After changing this value, recalculate the machine paths.</p>
      <p className="workspace-caption" role="status">{pathsStale ? "Machine paths are out of date. Recalculate before playback or export. Statistics show the previous plan." : "Machine paths are up to date."}</p>
      <PaintSimulationControls settings={project.strokeSettings} onChange={settings => onPaintSimulationChange(settings.paintSimulation!)} />
</aside></div>
    {!!timeline.issues.length && <div className="workspace-validation has-issues" role="alert"><strong>Resolve these issues before playback:</strong><ul>{timeline.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
    <div className="flow-actions"><button className="flow-back" onClick={onBack}>← Workspace</button><button className="flow-next" disabled={pathsStale || !!timeline.issues.length || !timeline.strokes} onClick={onNext}>Continue to Export →</button></div>
  </section>;
}
