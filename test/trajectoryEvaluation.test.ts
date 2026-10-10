import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTrajectories } from "../src/core/trajectoryEvaluation.ts";
import type { Stroke } from "../src/core/model.ts";
const map = { widthPx: 4, heightPx: 2, paintIds: ["red", "blue"], pixels: new Uint8Array([0, 0, 1, 255, 0, 0, 1, 255]) };
const canvas = { widthMm: 4, heightMm: 2 };
const brush = { name: "test", shape: "round" as const, widthMm: 1 };
const stroke = (paintId: string, x: number): Stroke => ({ type: "stroke", paintId, points: [{ x, y: 0 }, { x, y: 2 }], pressure: .5, speedMmPerMin: 100, expectedLoadStart: 1, expectedLoadEnd: .8 });
const evaluate = (operations: Stroke[]) => evaluateTrajectories({ formatVersion: 1, projectId: "test", operations }, map, canvas, brush);
test("oracle distinguishes missing, wrong paint and masked spill", () => {
  const result = evaluate([stroke("red", .5), stroke("red", 2.5), stroke("blue", 3.5)]);
  assert.equal(result.metrics.correctPixels, 2);
  assert.equal(result.metrics.missingPixels, 2);
  assert.equal(result.metrics.wrongPixels, 2);
  assert.equal(result.metrics.spillPixels, 2);
});
test("final colour follows stroke order; repeated vertices do not inflate overlap", () => {
  const first = stroke("red", .5);
  const result = evaluate([{ ...first, points: [...first.points, first.points[0]] }, stroke("blue", .5)]);
  assert.equal(result.metrics.overlap, .25);
  assert.equal(result.painted[0], 1);
  assert.equal(result.metrics.wrongPixels, 2);
  assert.equal(evaluate([{ ...first, points: [...first.points, first.points[0]] }]).metrics.overlap, 0);
});
test("invalid and outside trajectories are reported without rasterizing NaN", () => {
  const result = evaluate([{ ...stroke("red", 0), points: [{ x: NaN, y: 0 }, { x: 1, y: 1 }] }, stroke("blue", -1)]);
  assert.equal(result.metrics.invalidStrokes, 1);
  assert.equal(result.metrics.outsideStrokes, 1);
  assert.equal(result.issues.length, 2);
});
test("raster uses physical dimensions on non-square pixels and flat square footprint", () => {
  const plan = { formatVersion: 1 as const, projectId: "test", operations: [stroke("red", 1)] };
  const scaledMap = { widthPx: 2, heightPx: 2, paintIds: ["red"], pixels: new Uint8Array(4) };
  const result = evaluateTrajectories(plan, scaledMap, { widthMm: 4, heightMm: 2 }, { ...brush, shape: "flat", widthMm: 1 });
  assert.equal(result.metrics.correctPixels, 2);
});
test("empty target has finite metrics and malformed dimensions are rejected", () => {
  const empty = evaluateTrajectories({ formatVersion: 1, projectId: "empty", operations: [] }, { ...map, pixels: new Uint8Array(8).fill(255) }, canvas, brush);
  assert.equal(empty.metrics.accuracy, 0);
  assert.equal(empty.metrics.targetPixels, 0);
  assert.throws(() => evaluateTrajectories({ formatVersion: 1, projectId: "bad", operations: [] }, map, { ...canvas, widthMm: 0 }, brush));
});
