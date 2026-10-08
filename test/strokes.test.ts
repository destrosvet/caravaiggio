import assert from "node:assert/strict";
import test from "node:test";
import {
  generateParallelStrokes,
  generateStyledStrokes,
} from "../src/core/strokes.ts";

const map = {
  widthPx: 4,
  heightPx: 4,
  paintIds: ["white", "red"],
  pixels: new Uint8Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]),
};
const brush = { name: "Flat 10", shape: "flat" as const, widthMm: 10 };
const settings = {
  style: "realism" as const,
  seed: "",
  geometry: "linear" as const,
  curvature: 0,
  direction: "horizontal" as const,
  overlap: 0,
  speedMmPerMin: 600,
  pressure: 0.5,
};

test("parallel strokes are clipped to contiguous color regions", () => {
  const plan = generateParallelStrokes(
    "project",
    map,
    { widthMm: 40, heightMm: 40 },
    brush,
    settings,
  );
  assert.equal(plan.operations.length, 8);
  assert.deepEqual(
    plan.operations[0].type === "stroke" && plan.operations[0].points,
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ],
  );
});

test("generated working strokes remain inside the canvas", () => {
  const plan = generateParallelStrokes(
    "project",
    map,
    { widthMm: 40, heightMm: 40 },
    brush,
    { ...settings, direction: "vertical", overlap: 0.5 },
  );
  for (const operation of plan.operations)
    if (operation.type === "stroke")
      for (const point of operation.points) {
        assert.ok(point.x >= 0 && point.x <= 40);
        assert.ok(point.y >= 0 && point.y <= 40);
      }
});

test("organic stroke variation is deterministic and not uniformly parallel", () => {
  const organic = {
    ...settings,
    style: "expressionism" as const,
    seed: "repeatable-study",
  };
  const first = generateStyledStrokes(
    "stable-project",
    map,
    { widthMm: 40, heightMm: 40 },
    brush,
    organic,
  );
  const second = generateStyledStrokes(
    "stable-project",
    map,
    { widthMm: 40, heightMm: 40 },
    brush,
    organic,
  );
  assert.deepEqual(first, second);
  const slopes = first.operations
    .filter((operation) => operation.type === "stroke")
    .map((operation) =>
      operation.type === "stroke"
        ? operation.points[1].y - operation.points[0].y
        : 0,
    );
  assert.ok(new Set(slopes).size > 1);
});

test("different explicit seeds create different organic variants", () => {
  const first = generateStyledStrokes(
    "project",
    map,
    { widthMm: 40, heightMm: 40 },
    brush,
    { ...settings, style: "abstract", seed: "one" },
  );
  const second = generateStyledStrokes(
    "project",
    map,
    { widthMm: 40, heightMm: 40 },
    brush,
    { ...settings, style: "abstract", seed: "two" },
  );
  assert.notDeepEqual(first, second);
});

test("curved geometry produces multi-point strokes inside color regions", () => {
  const plan = generateStyledStrokes(
    "curves",
    map,
    { widthMm: 40, heightMm: 40 },
    brush,
    {
      ...settings,
      style: "impressionism",
      geometry: "curved",
      curvature: 0.7,
      seed: "curved",
    },
  );
  const curved = plan.operations.filter(
    (operation) => operation.type === "stroke" && operation.points.length > 2,
  );
  assert.ok(curved.length > 0);
  for (const operation of curved)
    if (operation.type === "stroke")
      for (const point of operation.points) {
        assert.ok(
          point.x >= 0 && point.x <= 40 && point.y >= 0 && point.y <= 40,
        );
      }
});

test("region flow follows the dominant local axis of a color area", () => {
  const plan = generateStyledStrokes(
    "flow",
    map,
    { widthMm: 40, heightMm: 40 },
    brush,
    { ...settings, direction: "flow", style: "realism", seed: "flow" },
  );
  const vertical = plan.operations.filter(
    (operation) =>
      operation.type === "stroke" &&
      Math.abs(operation.points[1].y - operation.points[0].y) >
        Math.abs(operation.points[1].x - operation.points[0].x),
  );
  assert.ok(vertical.length > plan.operations.length / 2);
});

test("large uniform areas produce long nested contour curves", () => {
  const size = 24;
  const uniform = {
    widthPx: size,
    heightPx: size,
    paintIds: ["blue"],
    pixels: new Uint8Array(size * size),
  };
  const plan = generateStyledStrokes(
    "contours",
    uniform,
    { widthMm: 120, heightMm: 120 },
    { name: "Round 5", shape: "round", widthMm: 5 },
    {
      ...settings,
      geometry: "contour",
      curvature: 0.45,
      direction: "flow",
      seed: "nested",
    },
  );
  const longCurves = plan.operations.filter(
    (operation) => operation.type === "stroke" && operation.points.length >= 5,
  );
  assert.ok(longCurves.length > 0);
});
