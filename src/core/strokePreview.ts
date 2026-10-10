import type { PaintingPlan } from "./model.ts";
import { buildSimulation } from "./simulation.ts";
import { optimizeStrokeOrder } from "./strokeOrdering.ts";
import { defaultWorkspace, syncWorkspace, validateWorkspace, type Workspace } from "./workspace.ts";

/** Strokes can be previewed before the physical machine layout is configured. */
export function strokePreviewTimeline(plan: PaintingPlan, canvas: { widthMm: number; heightMm: number },
  palette: readonly { id: string; name: string; skipPainting: boolean }[], workspace: Workspace, capacity: number, brushWidth: number) {
  let layout = syncWorkspace(workspace, canvas, palette);
  const layoutIssues = validateWorkspace(layout);
  if (layoutIssues.length) layout = syncWorkspace(defaultWorkspace(canvas, palette.filter(paint => !paint.skipPainting).length), canvas, palette);
  const ordered = optimizeStrokeOrder(plan, layout);
  const timeline = buildSimulation(ordered, layout, capacity, brushWidth);
  if (timeline.issues.length && !timeline.events.some(event => event.type === "stroke")) {
    throw new Error(timeline.issues.join(" "));
  }
  return { timeline, origin: layout.zones.find(zone => zone.type === "canvas")!, provisional: layoutIssues.length > 0 };
}
