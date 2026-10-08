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

test("increasing curvature produces a larger visible bow for the same seed", () => {
  const size = 100;
  const uniform = { widthPx: size, heightPx: size, paintIds: ["blue"], pixels: new Uint8Array(size * size) };
  const generate = (curvature: number) => generateStyledStrokes("curvature", uniform, { widthMm: 200, heightMm: 200 }, { name: "Brush", shape: "round", widthMm: 8 }, { ...settings, seed: "same-shape", geometry: "curved", curvature, direction: "horizontal", minStrokeLengthMm: 50, maxStrokeLengthMm: 50, joinNearbyStrokes: false });
  const deviation = (plan: ReturnType<typeof generate>) => Math.max(...plan.operations.filter(operation => operation.type === "stroke").map(operation => {
    if (operation.type !== "stroke") return 0;
    const a = operation.points[0], b = operation.points.at(-1)!;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord < 35) return 0;
    return Math.max(...operation.points.map(point => Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y)) / chord));
  }));
  const subtle = deviation(generate(0.1)), strong = deviation(generate(0.58));
  assert.ok(strong > 10);
  assert.ok(strong > subtle * 3);
});

test("curved horizontal 10mm strokes cover fragmented colour regions including skipped coarse-grid pixels", () => {
  const size = 40;
  const fragmented = { widthPx: size, heightPx: size, paintIds: ["gold", "brown"], pixels: new Uint8Array(size * size) };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) fragmented.pixels[y * size + x] = x < 2 || y < 2 ? 255 : (Math.floor(x / 3) + Math.floor(y / 3)) % 2;
  const plan = generateStyledStrokes("fill", fragmented, { widthMm: 100, heightMm: 100 }, { name: "10mm", shape: "flat", widthMm: 10 }, { ...settings, seed: "fill-test", geometry: "curved", curvature: 0.18, direction: "horizontal", overlap: 0.2, minStrokeLengthMm: 1, maxStrokeLengthMm: 75, joinNearbyStrokes: true });
  const covered = new Uint8Array(size * size);
  for (const stroke of plan.operations) if (stroke.type === "stroke") for (let segment = 1; segment < stroke.points.length; segment++) {
    const a = stroke.points[segment - 1], b = stroke.points[segment];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * size / 100 * 2));
    const radius = 4.1 * size / 100;
    for (let step = 0; step <= steps; step++) {
      const x = (a.x + (b.x - a.x) * step / steps) * size / 100, y = (a.y + (b.y - a.y) * step / steps) * size / 100;
      for (let py = Math.max(0, Math.floor(y - radius)); py < Math.min(size, Math.ceil(y + radius)); py++) for (let px = Math.max(0, Math.floor(x - radius)); px < Math.min(size, Math.ceil(x + radius)); px++) {
        if (Math.hypot(px + 0.5 - x, py + 0.5 - y) <= radius && fragmented.paintIds[fragmented.pixels[py * size + px]] === stroke.paintId) covered[py * size + px] = 1;
      }
    }
  }
  for (let index = 0; index < covered.length; index++) if (fragmented.pixels[index] !== 255) assert.equal(covered[index], 1, `Unfilled material pixel ${index}`);
});

test("all final trajectories respect minimum and maximum including curved and fill strokes", () => {
  const size = 60;
  const region = { widthPx: size, heightPx: size, paintIds: ["gold", "brown"], pixels: new Uint8Array(size * size) };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (x > 30 && (x + y) % 3 === 0) region.pixels[y * size + x] = 1;
  const plan = generateStyledStrokes("limits", region, { widthMm: 300, heightMm: 300 }, { name: "10mm", shape: "flat", widthMm: 10 }, { ...settings, seed: "limits", geometry: "curved", curvature: 0.58, minStrokeLengthMm: 69, maxStrokeLengthMm: 235, joinNearbyStrokes: true });
  assert.ok(plan.operations.length > 0);
  assert.ok(plan.generationStats!.omittedShortStrokes > 0);
  for (const stroke of plan.operations) if (stroke.type === "stroke") {
    const length = stroke.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - stroke.points[index].x, point.y - stroke.points[index].y), 0);
    assert.ok(length >= 69 - 1e-6 && length <= 235 + 1e-6, `Out-of-range length ${length}`);
  }
});
