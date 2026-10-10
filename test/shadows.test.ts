import test from "node:test";
import assert from "node:assert/strict";
import { generateStyledStrokes, strokeStylePresets, type ColorRegionMap } from "../src/core/strokes.ts";
import { shadowDefaults, validateShadows } from "../src/core/shadows.ts";
import { optimizeStrokeOrder } from "../src/core/strokeOrdering.ts";
import { defaultWorkspace, syncWorkspace } from "../src/core/workspace.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
const canvas = { widthMm: 120, heightMm: 80 }, brush = { name: "Test", widthMm: 4, shape: "round" as const };
const palette = [{ id: "skin", hex: "#C6A68C", name: "Skin", skipPainting: false }, { id: "dark", hex: "#433329", name: "Dark", skipPainting: false }];
const source = Float32Array.from({ length: 60 * 40 }, (_, i) => i % 60 > 18 && i % 60 < 42 && Math.floor(i / 60) > 12 && Math.floor(i / 60) < 29 ? .3 : .68);
const map: ColorRegionMap = { widthPx: 60, heightPx: 40, paintIds: palette.map(p => p.id), pixels: new Uint8Array(2400), luminance: source, palette };
const settings = { ...strokeStylePresets.realism.settings, strategy: "flow-curves" as const, strategyParameters: {}, seed: "shadow-test", shadows: { ...shadowDefaults, enabled: true } };
const generate = (input = map, config = settings) => generateStyledStrokes("test", input, canvas, brush, config);
test("source shadows add deterministic darker strokes only in the dark patch", () => {
  const plan = generate(); assert.deepEqual(plan, generate());
  const shadows = plan.operations.filter(op => op.type === "stroke" && op.phase === "shadows");
  assert.ok(shadows.length > 0);
  for (const op of shadows) if (op.type === "stroke") {
    assert.equal(op.paintId, "dark");
    assert.ok(op.pressure < settings.pressure);
    for (const q of op.points) assert.ok(q.x > 36 && q.x < 84 && q.y > 24 && q.y < 60);
  }
  assert.deepEqual(plan.operations.slice(0, -shadows.length), generate(map, { ...settings, shadows: { ...shadowDefaults, enabled: false } }).operations);
});
test("bright surfaces, isolated noise and darkest paint are not overpainted", () => {
  for (const luminance of [new Float32Array(2400).fill(.9), Float32Array.from({ length: 2400 }, (_, i) => i === 1200 ? 0 : .68)])
    assert.equal(generate({ ...map, luminance }).shadowStats?.strokes, 0);
  const darkest = generate({ ...map, pixels: new Uint8Array(2400).fill(1), luminance: new Float32Array(2400).fill(.05) });
  assert.equal(darkest.shadowStats?.strokes, 0); assert.ok(darkest.shadowStats!.noDarkerPaintSeeds > 0);
});
test("full brush footprint stays clear of mask holes", () => {
  const pixels = map.pixels.slice(); pixels[20 * 60 + 30] = 255;
  const plan = generate({ ...map, pixels });
  for (const op of plan.operations) if (op.type === "stroke" && op.phase === "shadows")
    for (const q of op.points) assert.ok(Math.hypot(q.x - 61, q.y - 41) > brush.widthMm / 2);
});
test("colour optimisation keeps every shadow after all base/contour operations", () => {
  const plan = generate(), workspace = syncWorkspace(defaultWorkspace(canvas), canvas, palette);
  const ordered = optimizeStrokeOrder(plan, workspace);
  const firstShadow = ordered.operations.findIndex(op => op.type === "stroke" && op.phase === "shadows");
  assert.ok(firstShadow > 0);
  assert.ok(ordered.operations.slice(firstShadow).every(op => op.type === "stroke" && op.phase === "shadows"));
  assert.deepEqual(new Set(ordered.operations), new Set(plan.operations));
});
test("shadow groups start with the last pigment after base optimisation", () => {
  const template = generate().operations.find(op => op.type === "stroke")!;
  const plan = { formatVersion: 1 as const, projectId: "reuse", operations: [
    { ...template, paintId: "skin" }, { ...template, paintId: "dark" }, { ...template, paintId: "skin" },
    { ...template, paintId: "skin", phase: "shadows" as const }, { ...template, paintId: "dark", phase: "shadows" as const },
  ] };
  const ordered = optimizeStrokeOrder(plan, syncWorkspace(defaultWorkspace(canvas), canvas, palette));
  const index = ordered.operations.findIndex(op => op.type === "stroke" && op.phase === "shadows");
  const before = ordered.operations[index - 1], after = ordered.operations[index];
  assert.ok(before.type === "stroke" && after.type === "stroke");
  assert.equal(after.paintId, before.paintId);
});
test("manual paint, missing paint, zero pressure and disabled shadows behave explicitly", () => {
  assert.equal(generate(map, { ...settings, shadows: { ...settings.shadows, paintId: "skin" } }).shadowStats?.strokes, 0);
  assert.equal(generate(map, { ...settings, shadows: { ...settings.shadows, paintId: "missing" } }).shadowStats?.strokes, 0);
  assert.equal(generate(map, { ...settings, pressure: 0 }).shadowStats, undefined);
  assert.throws(() => generate({ ...map, luminance: undefined }), /source image/);
});
test("automatic shadows honour accent colour restrictions and choose an eligible alternative", () => {
  const restricted = { ...palette[1], restricted: true, minimumChroma: 1, hueToleranceDeg: 1 };
  const input = { ...map, palette: [palette[0], restricted, { ...palette[1], id: "neutral", hex: "#202020" }], paintIds: ["skin", "dark", "neutral"] };
  const plan = generate(input);
  assert.ok(plan.shadowStats!.strokes > 0);
  assert.ok(plan.operations.filter(op => op.type === "stroke" && op.phase === "shadows").every(op => op.type === "stroke" && op.paintId === "neutral"));
});
test("shadow parameters persist in projects; old projects default to no extra pass", () => {
  const project = createProject();
  const reopened = parseProject(serializeProject({ ...project, strokeSettings: settings }));
  assert.deepEqual(reopened.strokeSettings.shadows, settings.shadows);
  const old = parseProject(JSON.stringify({ ...project, version: 9 })); assert.equal(old.strokeSettings.shadows?.enabled, false);
  assert.throws(() => validateShadows({ ...shadowDefaults, density: Infinity }));
});
