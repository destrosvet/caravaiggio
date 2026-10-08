import assert from "node:assert/strict";
import test from "node:test";
import { joinNearbyStrokes } from "../src/core/strokeJoining.ts";
import { generateStyledStrokes } from "../src/core/strokes.ts";
import type { Stroke } from "../src/core/model.ts";
const map = { widthPx: 100, heightPx: 100, paintIds: ["blue", "red"], pixels: new Uint8Array(10000) };
const canvas = { widthMm: 100, heightMm: 100 };
const stroke = (x1: number, x2: number): Stroke => ({ type: "stroke", paintId: "blue", points: [{ x: x1, y: 20 }, { x: x2, y: 20 }], speedMmPerMin: 400, pressure: 0.5, expectedLoadStart: 1, expectedLoadEnd: 0.5 });
test("nearby same-colour trajectories join into a continuous stroke including reversed endpoints", () => {
  const joined = joinNearbyStrokes([stroke(10, 30), stroke(60, 32)], map, canvas, 6, 100);
  assert.equal(joined.length, 1);
  assert.deepEqual(joined[0].points, [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 32, y: 20 }, { x: 60, y: 20 }]);
});
test("joining does not cross colour gaps or exceed the length limit", () => {
  const gap = { ...map, pixels: new Uint8Array(map.pixels) };
  for (let y = 0; y < 100; y++) gap.pixels[y * 100 + 31] = 1;
  assert.equal(joinNearbyStrokes([stroke(10, 30), stroke(32, 60)], gap, canvas, 6, 100).length, 2);
  assert.equal(joinNearbyStrokes([stroke(10, 30), stroke(32, 60)], map, canvas, 6, 40).length, 2);
  assert.equal(joinNearbyStrokes([stroke(10, 30), { ...stroke(32, 60), paintId: "red" }], map, canvas, 6, 100).length, 2);
});
test("a nearby boundary no longer shortens strokes along a long uniform region", () => {
  const narrow = { widthPx: 100, heightPx: 12, paintIds: ["blue"], pixels: new Uint8Array(1200) };
  const plan = generateStyledStrokes("long", narrow, { widthMm: 100, heightMm: 12 }, { name: "Brush", shape: "flat", widthMm: 2 }, {
    style: "realism", seed: "long-test", geometry: "linear", curvature: 0, direction: "horizontal", overlap: 0.2, speedMmPerMin: 400, pressure: 0.5, minStrokeLengthMm: 10, maxStrokeLengthMm: 80, joinNearbyStrokes: false,
  });
  const lengths = plan.operations.filter(operation => operation.type === "stroke").map(operation => operation.type === "stroke" ? Math.hypot(operation.points.at(-1)!.x - operation.points[0].x, operation.points.at(-1)!.y - operation.points[0].y) : 0);
  assert.ok(Math.max(...lengths) > 70);
  assert.ok(lengths.filter(length => length > 35).reduce((sum, length) => sum + length, 0) > 150); // Edge fill strokes may be short; interior strokes remain long.
});
