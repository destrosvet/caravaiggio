import { optimizeStrokeOrder } from "../core/strokeOrdering.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PaintingPlan } from "../core/model.ts";
import { buildSimulation, simulationPosition, type SimulationEvent } from "../core/simulation.ts";
import { syncWorkspace } from "../core/workspace.ts";
import type { CaravaiggioProject } from "../project/model.ts";
type Props = { project: CaravaiggioProject; plan: PaintingPlan | null; onCapacityChange: (capacity: number) => void; onBack: () => void; onRegenerate: () => void; onNext: () => void };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function Simulation({ project, plan, onCapacityChange, onBack, onRegenerate, onNext }: Props) {
  const workspace = useMemo(() => syncWorkspace(project.workspace, project.canvas, project.palette), [project.workspace, project.canvas, project.palette]);
  const [optimize, setOptimize] = useState(true);
  const orderedPlan = useMemo(() => plan && optimize ? optimizeStrokeOrder(plan, workspace) : plan, [plan, workspace, optimize]);
  const timeline = useMemo(() => orderedPlan ? buildSimulation(orderedPlan, workspace, project.strokeSettings.paintLoadLengthMm ?? 120, project.brush.widthMm) : null, [orderedPlan, workspace, project.strokeSettings.paintLoadLengthMm, project.brush.widthMm]);
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(50), [showTravel, setShowTravel] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const paintLayer = useRef<{ canvas: HTMLCanvasElement; index: number; time: number; timeline: typeof timeline } | null>(null);
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
    if (!paintLayer.current || paintLayer.current.timeline !== timeline || time < paintLayer.current.time) {
      const layer = document.createElement("canvas"); layer.width = width; layer.height = height;
      paintLayer.current = { canvas: layer, index: 0, time: 0, timeline };
    }
    const layer = paintLayer.current, paint = layer.canvas.getContext("2d")!;
    const canvasZone = workspace.zones.find(zone => zone.type === "canvas")!;
    const draw = (ctx: CanvasRenderingContext2D, event: SimulationEvent, until: number) => {
      if (event.type !== "stroke") return;
      const end = simulationPosition(event, until);
      ctx.save(); ctx.beginPath(); ctx.rect(canvasZone.x * scale, canvasZone.y * scale, canvasZone.width * scale, canvasZone.height * scale); ctx.clip();
      ctx.strokeStyle = project.palette.find(color => color.id === event.paintId)?.hex ?? "#fff";
      ctx.globalAlpha = Math.max(0.12, Math.min(1, (event.pressure ?? 0.5) * (0.6 + event.loadStart * 0.4)));
      ctx.lineWidth = project.brush.widthMm * scale; ctx.lineCap = project.brush.shape === "round" ? "round" : "square";
      ctx.beginPath(); ctx.moveTo(event.from.x * scale, event.from.y * scale); ctx.lineTo(end.x * scale, end.y * scale); ctx.stroke(); ctx.restore();
    };
    while (layer.index < timeline.events.length && timeline.events[layer.index].end <= time) { draw(paint, timeline.events[layer.index], time); layer.index++; }
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
    context.drawImage(layer.canvas, 0, 0);
    if (active) draw(context, active, time);
    if (showTravel) {
      context.save(); context.strokeStyle = "#e7bf7266"; context.lineWidth = 1; context.setLineDash([4, 4]);
      for (let index = 0; index <= activeIndex; index++) { const event = timeline.events[index]; if (event.type !== "move") continue; const end = simulationPosition(event, time); context.beginPath(); context.moveTo(event.from.x * scale, event.from.y * scale); context.lineTo(end.x * scale, end.y * scale); context.stroke(); }
      context.restore();
    }
    if (active) { const point = simulationPosition(active, time); context.strokeStyle = active.type === "stroke" ? "#fff" : "#e7bf72"; context.lineWidth = 2; context.beginPath(); context.arc(point.x * scale, point.y * scale, Math.max(5, project.brush.widthMm * scale / 2), 0, Math.PI * 2); context.stroke(); }
  }, [time, timeline, workspace, project.palette, project.brush, showTravel, active, activeIndex]);
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
      <p className="eyebrow">Current operation</p><strong>{time >= timeline.duration ? "Finished" : active?.type ?? "Ready"}</strong><p>{project.palette.find(color => color.id === active?.paintId)?.name ?? "Brush"}</p><label>Paint load <meter min="0" max="1" value={load} /> {Math.round(load * 100)}%</label><dl><dt>Estimated time</dt><dd>{clock(timeline.duration)}</dd><dt>Strokes</dt><dd>{timeline.strokes}</dd><dt>Paint loads</dt><dd>{timeline.loads}</dd><dt>Cleaning cycles</dt><dd>{timeline.cleans}</dd><dt>Painting distance</dt><dd>{(timeline.paintDistance / 1000).toFixed(2)} m</dd><dt>Travel distance</dt><dd>{(timeline.travelDistance / 1000).toFixed(2)} m</dd></dl><p className="workspace-caption">Travel 1500 mm/min · Load 1.5 s · Wash 3 s · Wipe 2 s</p></aside></div>
    {!!timeline.issues.length && <div className="workspace-validation has-issues" role="alert"><strong>Resolve these issues before playback:</strong><ul>{timeline.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
    <div className="flow-actions"><button className="flow-back" onClick={onBack}>← Workspace</button><button className="flow-next" disabled={!!timeline.issues.length || !timeline.strokes} onClick={onNext}>Continue to Export →</button></div>
  </section>;
}
