import assert from "node:assert/strict";
import test from "node:test";
import { optimizeStrokeOrder } from "../src/core/strokeOrdering.ts";
import { buildSimulation } from "../src/core/simulation.ts";
import { createProject } from "../src/project/model.ts";
import type { PaintingPlan, Stroke } from "../src/core/model.ts";
const stroke = (paintId: string, x: number, y = 20): Stroke => ({ type: "stroke", points: [{ x, y }, { x: x + 5, y }], paintId, pressure: 0.5, speedMmPerMin: 300, expectedLoadStart: 1, expectedLoadEnd: 0.9 });
const plan = (operations: Stroke[]): PaintingPlan => ({ formatVersion: 1, projectId: "test", operations });
test("colour grouping reduces cleaning and preserves every stroke and its direction", () => {
  const project = createProject();
  const source = plan([stroke("cadmium-red", 10), stroke("ultramarine-blue", 40), stroke("cadmium-red", 20), stroke("ultramarine-blue", 50)]);
  const ordered = optimizeStrokeOrder(source, project.workspace);
  assert.deepEqual(ordered.operations.map(operation => operation.type === "stroke" ? operation.paintId : ""), ["cadmium-red", "cadmium-red", "ultramarine-blue", "ultramarine-blue"]);
  assert.deepEqual(new Set(ordered.operations), new Set(source.operations));
  const baseline = buildSimulation(source, project.workspace, 1000, 6), optimized = buildSimulation(ordered, project.workspace, 1000, 6);
  assert.equal(baseline.cleans, 4); assert.equal(optimized.cleans, 2);
  assert.equal(baseline.paintDistance, optimized.paintDistance);
  assert.ok(optimized.duration < baseline.duration);
});
test("nearest stroke ordering shortens travel and is deterministic", () => {
  const project = createProject();
  const source = plan([stroke("cadmium-red", 10), stroke("cadmium-red", 200), stroke("cadmium-red", 20), stroke("cadmium-red", 190)]);
  const ordered = optimizeStrokeOrder(source, project.workspace);
  const before = buildSimulation(source, project.workspace, 1000, 6), after = buildSimulation(ordered, project.workspace, 1000, 6);
  assert.ok(after.travelDistance < before.travelDistance);
  assert.deepEqual(optimizeStrokeOrder(source, project.workspace), ordered);
});
test("larger paint capacity reduces cup visits without changing painted distance", () => {
  const project = createProject();
  const source = plan([{ ...stroke("cadmium-red", 10), points: [{ x: 10, y: 20 }, { x: 210, y: 20 }] }]);
  const small = buildSimulation(source, project.workspace, 50, 6), large = buildSimulation(source, project.workspace, 200, 6);
  assert.equal(small.loads, 4); assert.equal(large.loads, 1);
  assert.equal(small.paintDistance, large.paintDistance);
  assert.ok(large.duration < small.duration);
});
test("explicit non-stroke operations remain ordering barriers", () => {
  const project = createProject();
  const source: PaintingPlan = { ...plan([stroke("cadmium-red", 10)]), operations: [stroke("cadmium-red", 10), { type: "wait", seconds: 2 }, stroke("ultramarine-blue", 20)] };
  assert.equal(optimizeStrokeOrder(source, project.workspace), source);
});
