import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "../src/project/model.ts";
import { strokePreviewTimeline } from "../src/core/strokePreview.ts";
import { buildSimulation } from "../src/core/simulation.ts";
import { renderPaintTimeline } from "../src/core/paintRaster.ts";
import type { PaintingPlan } from "../src/core/model.ts";

test("Strokes paints a preview even when the later machine layout is invalid", () => {
  const project = createProject();
  const plan: PaintingPlan = { formatVersion: 1, projectId: project.id, operations: [{
    type: "stroke", paintId: project.palette.find(paint => !paint.skipPainting)!.id, points: [{ x: 10, y: 20 }, { x: 150, y: 20 }],
    pressure: .5, speedMmPerMin: 300, expectedLoadStart: 1, expectedLoadEnd: 0,
  }] };
  const workspace = { ...project.workspace, width: 40 };
  const machine = buildSimulation(plan, workspace, 120, project.brush.widthMm);
  assert.ok(machine.issues.length);
  assert.equal(machine.events.length, 0);
  const preview = strokePreviewTimeline(plan, project.canvas, project.palette, workspace, 120, project.brush.widthMm);
  assert.equal(preview.provisional, true);
  assert.deepEqual(preview.timeline.issues, []);
  assert.ok(preview.timeline.events.some(event => event.type === "stroke"));
  const raster = renderPaintTimeline(preview.timeline, project.canvas, project.brush, project.palette, 80, 100, undefined, undefined, preview.origin);
  assert.ok(raster.coverage.some(value => value > 0));
  assert.equal(workspace.width, 40);
});

test("a configured valid workspace retains its actual service timeline", () => {
  const project = createProject();
  const plan: PaintingPlan = { formatVersion: 1, projectId: project.id, operations: [] };
  const preview = strokePreviewTimeline(plan, project.canvas, project.palette, project.workspace, 120, project.brush.widthMm);
  assert.equal(preview.provisional, false);
  assert.deepEqual(preview.timeline, buildSimulation(plan, project.workspace, 120, project.brush.widthMm));
});
