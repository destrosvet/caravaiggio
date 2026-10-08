import type { PaintingPlan, Point } from "./model.ts";
import type { Workspace, WorkspaceZone } from "./workspace.ts";
import { validateWorkspace } from "./workspace.ts";
export type SimulationEvent = Readonly<{ type: "move" | "stroke" | "load" | "clean" | "wipe" | "park"; from: Point; to: Point; start: number; end: number; paintId?: string; pressure?: number; loadStart: number; loadEnd: number }>;
export type SimulationTimeline = Readonly<{ events: readonly SimulationEvent[]; duration: number; paintDistance: number; travelDistance: number; strokes: number; loads: number; cleans: number; issues: readonly string[] }>;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const centre = (zone: WorkspaceZone): Point => ({ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 });
export function segmentIntersectsZone(a: Point, b: Point, zone: WorkspaceZone, margin = 0): boolean {
  let low = 0, high = 1;
  for (const [start, delta, min, max] of [[a.x, b.x - a.x, zone.x - margin, zone.x + zone.width + margin], [a.y, b.y - a.y, zone.y - margin, zone.y + zone.height + margin]]) {
    if (Math.abs(delta) < 1e-9) { if (start < min || start > max) return false; }
    else { const first = (min - start) / delta, last = (max - start) / delta; low = Math.max(low, Math.min(first, last)); high = Math.min(high, Math.max(first, last)); if (low > high) return false; }
  }
  return true;
}
export function buildSimulation(plan: PaintingPlan, workspace: Workspace, capacity: number, brushWidth: number): SimulationTimeline {
  const issues = [...validateWorkspace(workspace)];
  if (!Number.isFinite(capacity) || capacity <= 0) issues.push("Paint load length must be positive.");
  const canvas = workspace.zones.find(zone => zone.type === "canvas"), water = workspace.zones.find(zone => zone.type === "water"), wipe = workspace.zones.find(zone => zone.type === "wipe"), parking = workspace.zones.find(zone => zone.type === "parking");
  const events: SimulationEvent[] = [];
  let position: Point = parking ? centre(parking) : { x: 0, y: 0 }, elapsed = 0, load = 0, paintId: string | undefined;
  let paintDistance = 0, travelDistance = 0, strokes = 0, loads = 0, cleans = 0;
  const add = (type: SimulationEvent["type"], to: Point, seconds: number, loadEnd = load, pressure?: number) => {
    events.push({ type, from: position, to, start: elapsed, end: elapsed + seconds, paintId, pressure, loadStart: load, loadEnd });
    elapsed += seconds; position = to; load = loadEnd;
  };
  const move = (to: Point) => { const length = distance(position, to); if (length > 1e-6) { travelDistance += length; add("move", to, length / 1500 * 60); } };
  const service = (zone: WorkspaceZone, type: "load" | "clean" | "wipe") => { move(centre(zone)); add(type, position, type === "clean" ? 3 : type === "wipe" ? 2 : 1.5, type === "load" ? 1 : 0); };
  if (!canvas || !water || !wipe || !parking) issues.push("Workspace requires canvas, water, wipe and parking zones.");
  if (!issues.length && canvas && water && wipe && parking) {
    for (const operation of plan.operations) {
      if (operation.type !== "stroke") continue;
      const cup = workspace.zones.find(zone => zone.type === "paint" && zone.paintId === operation.paintId);
      if (!cup) { issues.push(`Missing paint container for ${operation.paintId}.`); break; }
      if (operation.speedMmPerMin <= 0 || !Number.isFinite(operation.speedMmPerMin)) { issues.push("Invalid stroke speed."); break; }
      if (paintId !== operation.paintId) {
        if (paintId) { service(water, "clean"); service(wipe, "wipe"); cleans++; }
        paintId = operation.paintId; service(cup, "load"); loads++;
      }
      strokes++;
      const points = operation.points.map(point => ({ x: canvas.x + point.x, y: canvas.y + point.y }));
      if (load <= 1e-6) { service(cup, 'load'); loads++; }
      move(points[0]);
      for (let index = 1; index < points.length; index++) {
        let from = points[index - 1]; const to = points[index];
        let remaining = distance(from, to);
        while (remaining > 1e-6) {
          if (load <= 1e-6) { service(cup, "load"); loads++; move(from); }
          const length = Math.min(remaining, load * capacity);
          const end = { x: from.x + (to.x - from.x) * length / remaining, y: from.y + (to.y - from.y) * length / remaining };
          add("stroke", end, length / operation.speedMmPerMin * 60, Math.max(0, load - length / capacity), operation.pressure);
          paintDistance += length; from = end; remaining = distance(from, to);
        }
      }
    }
    if (paintId) { service(water, "clean"); service(wipe, "wipe"); cleans++; }
    move(centre(parking)); add("park", position, 0);
  }
  const forbidden = workspace.zones.filter(zone => zone.type === "forbidden");
  for (const zone of forbidden) if (events.some(event => segmentIntersectsZone(event.from, event.to, zone, brushWidth / 2))) issues.push(`The brush path crosses forbidden zone ${zone.name}. Move this zone or change the layout.`);
  return { events, duration: elapsed, paintDistance, travelDistance, strokes, loads, cleans, issues };
}
export function simulationPosition(event: SimulationEvent, time: number): Point {
  const progress = event.end > event.start ? Math.max(0, Math.min(1, (time - event.start) / (event.end - event.start))) : 1;
  return { x: event.from.x + (event.to.x - event.from.x) * progress, y: event.from.y + (event.to.y - event.from.y) * progress };
}
