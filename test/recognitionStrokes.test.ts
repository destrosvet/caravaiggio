import assert from "node:assert/strict";
import test from "node:test";
import { addRecognitionStrokes } from "../src/core/recognitionStrokes.ts";
import { brushScaleMap } from "../src/core/brushScaleMap.ts";
import { generateStyledStrokes, type ColorRegionMap } from "../src/core/strokes.ts";
import { optimizeStrokeOrder } from "../src/core/strokeOrdering.ts";
import { createProject } from "../src/project/model.ts";
import { joinMachineStrokes } from "../src/core/machineStrokeJoining.ts";
import type { PaintingPlan, Stroke } from "../src/core/model.ts";

const project = createProject();
const canvas = { widthMm: 20, heightMm: 20 };
function fixture(): ColorRegionMap {
  const pixels = new Uint8Array(400), recognitionMap = new Uint8Array(400);
  for (const i of [42, 45, 201, 205]) { pixels[i] = 1; recognitionMap[i] = 255; }
  pixels[399] = 255; recognitionMap[399] = 255;
  return { widthPx: 20, heightPx: 20, pixels, recognitionMap, paintIds: ["skin", "dark"], luminance: Float32Array.from(pixels, p => p === 1 ? .1 : .7) };
}
test("small pupils survive the brush-scale noise filter, while unprotected noise is removed", () => {
  const map = fixture();
  assert.equal(brushScaleMap(map, canvas, 10).pixels[42], 1);
  assert.equal(brushScaleMap({ ...map, recognitionMap: undefined }, canvas, 10).pixels[42], 0);
});
test("every disconnected feature gets a final stroke, even with a large brush or long minimum", () => {
  const map = fixture();
  const plan: PaintingPlan = { formatVersion: 1, projectId: "test", operations: [] };
  const result = addRecognitionStrokes(plan, map, canvas, { ...project.brush, widthMm: 10 }, project.strokeSettings);
  assert.equal(result.recognitionStats?.components, 4);
  assert.equal(result.recognitionStats?.strokes, 4);
  for (const op of result.operations) {
    assert.equal(op.type, "stroke"); if (op.type !== "stroke") continue;
    assert.equal(op.phase, "recognition"); assert.equal(op.paintId, "dark");
    for (const q of op.points) {
      const i = Math.floor(q.y) * 20 + Math.floor(q.x);
      assert.equal(map.pixels[i], 1); assert.equal(map.recognitionMap![i], 255);
    }
  }
  assert.equal(addRecognitionStrokes(plan, { ...map, recognitionMap: undefined }, canvas, project.brush, project.strokeSettings), plan);
});
test("recognition pass works in every strategy, follows contours and shadows, and remains last after ordering", () => {
  const map = fixture();
  for (const strategy of ["legacy", "flow-curves", "curved-offsets", "dabs", "decorative-lines"] as const) {
    const plan = generateStyledStrokes("test", map, canvas, project.brush, { ...project.strokeSettings, strategy, strategyParameters: undefined, seed: "faces" });
    assert.equal(plan.recognitionStats?.strokes, 4, strategy);
  }
  const stroke: Stroke = { type: "stroke", paintId: "dark", points: [{ x: 1, y: 1 }, { x: 2, y: 1 }], pressure: .5, speedMmPerMin: 400, expectedLoadStart: 1, expectedLoadEnd: .9 };
  const plan: PaintingPlan = { formatVersion: 1, projectId: "test", operations: [{ ...stroke, phase: "recognition" }, { ...stroke, phase: "shadows" }, stroke, { ...stroke, phase: "contours" }] };
  const ordered = optimizeStrokeOrder(plan, project.workspace);
  assert.deepEqual(ordered.operations.map(op => op.type === "stroke" ? op.phase : op.type), [undefined, "contours", "shadows", "recognition"]);
});
test("machine optimization cannot connect nearby recognition strokes into a painted bridge", () => {
  const op: Stroke = { type: "stroke", phase: "recognition", paintId: "dark", points: [{ x: 1, y: 1 }, { x: 2, y: 1 }], pressure: .5, speedMmPerMin: 400, expectedLoadStart: 1, expectedLoadEnd: .9 };
  const map = { widthPx: 20, heightPx: 20, pixels: new Uint8Array(400), paintIds: ["dark"] };
  const plan: PaintingPlan = { formatVersion: 1, projectId: "test", operations: [op, { ...op, points: [{ x: 3, y: 1 }, { x: 4, y: 1 }] }] };
  assert.equal(joinMachineStrokes(plan, map, canvas, 1, 3).joins, 0);
});
