import { optimizeStrokeOrder } from "../core/strokeOrdering.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PaintingPlan } from "../core/model.ts";
import { buildSimulation, simulationPosition, type SimulationEvent } from "../core/simulation.ts";
import { syncWorkspace } from "../core/workspace.ts";
import type { CaravaiggioProject } from "../project/model.ts";
import { PaintRaster, paintSimulationDefaults, paintPreviewLongestEdge } from "../core/paintRaster.ts";
import { PaintSimulationControls } from "./StrokeTemplatePanel.tsx";
import type { PaintSimulationSettings } from "../core/paintRaster.ts";
type Props = { project: CaravaiggioProject; plan: PaintingPlan | null; onCapacityChange: (capacity: number) => void; onPaintSimulationChange: (settings: PaintSimulationSettings) => void; onBack: () => void; onRegenerate: () => void; onNext: () => void };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function Simulation({ project, plan, onCapacityChange, onPaintSimulationChange, onBack, onRegenerate, onNext }: Props) {
  const workspace = useMemo(() => syncWorkspace(project.workspace, project.canvas, project.palette), [project.workspace, project.canvas, project.palette]);
  const [optimize, setOptimize] = useState(true);
  const orderedPlan = useMemo(() => plan && optimize ? optimizeStrokeOrder(plan, workspace) : plan, [plan, workspace, optimize]);
  const timeline = useMemo(() => orderedPlan ? buildSimulation(orderedPlan, workspace, project.strokeSettings.paintLoadLengthMm ?? 120, project.brush.widthMm) : null, [orderedPlan, workspace, project.strokeSettings.paintLoadLengthMm, project.brush.widthMm]);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(50), [showTravel, setShowTravel] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const paintLayer = useRef<{ canvas: HTMLCanvasElement; raster: PaintRaster; index: number; time: number; timeline: typeof timeline; settings: typeof project.strokeSettings.paintSimulation } | null>(null);
  useEffect(() => { setTime(0); setPlaying(false); paintLayer.current = null; }, [timeline]);
  useEffect(() => {
    if (!playing || !timeline) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - previous) / 1000; previous = now;
      setTime(current => Math.min(timeline.duration, current + Math.min(elapsed, 0.1) * speed));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, timeline]);
  useEffect(() => { if (timeline && time >= timeline.duration) setPlaying(false); }, [time, timeline]);
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
      const fraction = event.end > event.start ? Math.max(0, Math.min(1, (until - event.start) / (event.end - event.start))) : 1;
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
  if (!timeline) return null;
  const load = active ? active.loadStart + (active.loadEnd - active.loadStart) * (active.end > active.start ? Math.max(0, Math.min(1, (time - active.start) / (active.end - active.start))) : 1) : 0;
  return <section><div className="intro"><p className="eyebrow">Step 05 · Simulation</p><h1>Watch the painting process.</h1><p>Playback follows the generated strokes and your workspace. Service times and paint coverage are estimates.</p></div>
    <div className="simulation-layout"><div className="simulation-preview"><canvas ref={canvas} aria-label="Animated painting and brush movement" />
      <div className="simulation-controls"><button disabled={!!timeline.issues.length || !timeline.strokes} onClick={() => { if (time >= timeline.duration) setTime(0); setPlaying(value => !value); }}>{playing ? "Pause" : "Play"}</button><button onClick={() => { setPlaying(false); setTime(0); }}>Restart</button><button disabled={!!timeline.issues.length} onClick={() => { setPlaying(false); setTime(timeline.duration); }}>Show result</button><label>Speed<select value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[1, 10, 50, 200].map(value => <option key={value} value={value}>{value}×</option>)}</select></label><label><input type="checkbox" checked={showTravel} onChange={event => setShowTravel(event.target.checked)} /> Travel paths</label></div>
      <input className="simulation-timeline" aria-label="Simulation time" type="range" min="0" max={timeline.duration} step="0.01" value={time} disabled={!!timeline.issues.length} onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }} /><p className="workspace-caption">{clock(time)} / {clock(timeline.duration)} · {timeline.duration ? Math.round(time / timeline.duration * 100) : 0}%</p>
    </div><aside className="simulation-stats"><label className="simulation-order-toggle"><input type="checkbox" checked={optimize} onChange={event => setOptimize(event.target.checked)} /> Group by colour and shorten travel</label>
      <label className="simulation-capacity">Paint load length · mm<input type="number" min="10" max="5000" step="10" value={project.strokeSettings.paintLoadLengthMm ?? 120} onChange={event => { const value = Number(event.target.value); if (event.target.value && Number.isFinite(value) && value >= 10 && value <= 5000) onCapacityChange(value); }} /></label>
      <p className="workspace-caption">Distance painted on one load, accumulated across strokes. Larger values mean fewer cup visits.</p>
      <PaintSimulationControls settings={project.strokeSettings} onChange={settings => onPaintSimulationChange(settings.paintSimulation!)} />
      <p className="eyebrow">Current operation</p><strong>{time >= timeline.duration ? "Finished" : active?.type ?? "Ready"}</strong><p>{project.palette.find(color => color.id === active?.paintId)?.name ?? "Brush"}</p><label>Paint load <meter min="0" max="1" value={load} /> {Math.round(load * 100)}%</label><dl><dt>Estimated time</dt><dd>{clock(timeline.duration)}</dd><dt>Strokes</dt><dd>{timeline.strokes}</dd><dt>Paint loads</dt><dd>{timeline.loads}</dd><dt>Cleaning cycles</dt><dd>{timeline.cleans}</dd><dt>Painting distance</dt><dd>{(timeline.paintDistance / 1000).toFixed(2)} m</dd><dt>Travel distance</dt><dd>{(timeline.travelDistance / 1000).toFixed(2)} m</dd></dl><p className="workspace-caption">Travel 1500 mm/min · Load 1.5 s · Wash 3 s · Wipe 2 s</p></aside></div>
    {!!timeline.issues.length && <div className="workspace-validation has-issues" role="alert"><strong>Resolve these issues before playback:</strong><ul>{timeline.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
    <div className="flow-actions"><button className="flow-back" onClick={onBack}>← Workspace</button><button className="flow-next" disabled={!!timeline.issues.length || !timeline.strokes} onClick={onNext}>Continue to Export →</button></div>
  </section>;
}
