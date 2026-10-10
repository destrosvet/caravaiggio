import test from "node:test";
import assert from "node:assert/strict";
import { generateStyledStrokes, strokeStylePresets } from "../src/core/strokes.ts";
import { strokeTemplates, applyStrokeTemplate } from "../src/core/strokeTemplates.ts";
import { strategyParameters } from "../src/core/strategySchema.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
const widthPx = 60, heightPx = 45;
const map = { widthPx, heightPx, paintIds: ["red", "blue"], pixels: Uint8Array.from({ length: widthPx * heightPx }, (_, i) => i % widthPx < 30 ? 0 : 1),
  luminance: Float32Array.from({ length: widthPx * heightPx }, (_, i) => (Math.sin((i % widthPx) * .2) + 1) / 2) };
const canvas = { widthMm: 120, heightMm: 90 };
for (const template of strokeTemplates.filter(t => t.settings.strategy !== "legacy")) {
  test(`${template.id}: stable seed, physical length limits and region-safe centre lines`, () => {
    const settings = { ...template.settings, seed: "test" };
    const plan = generateStyledStrokes("test", map, canvas, template.brush, settings);
    assert.deepEqual(plan, generateStyledStrokes("test", map, canvas, template.brush, settings));
    assert.ok(plan.operations.length > 0);
    for (const stroke of plan.operations) {
      assert.equal(stroke.type, "stroke"); if (stroke.type !== "stroke") continue;
      const length = stroke.points.slice(1).reduce((total, p, i) => total + Math.hypot(p.x - stroke.points[i].x, p.y - stroke.points[i].y), 0);
      assert.ok(length >= settings.minStrokeLengthMm! - 1e-6);
      assert.ok(length <= settings.maxStrokeLengthMm! + 1e-6);
      for (const p of stroke.points) {
        assert.ok(p.x >= 0 && p.x < canvas.widthMm && p.y >= 0 && p.y < canvas.heightMm);
        const index = Math.floor(p.y / canvas.heightMm * heightPx) * widthPx + Math.floor(p.x / canvas.widthMm * widthPx);
        assert.equal(map.paintIds[map.pixels[index]], stroke.paintId);
      }
    }
  });
}
test("template parameters change actual trajectories", () => {
  const template = strokeTemplates.find(t => t.id === "colour-dabs")!;
  const generate = (spacing: number) => generateStyledStrokes("test", map, canvas, template.brush, { ...template.settings, seed: "test", strategyParameters: { spacing } });
  assert.ok(generate(.6).operations.length > generate(2).operations.length);
});
test("template application copies defaults and preserves chosen seed", () => {
  const template = strokeTemplates[0], applied = applyStrokeTemplate(template, "preserve-me");
  assert.equal(applied.strokeSettings.seed, "preserve-me");
  assert.notEqual(applied.brush, template.brush);
  assert.notEqual(applied.strokeSettings.strategyParameters, template.settings.strategyParameters);
});
test("strategy parameters and simulation survive project round trip", () => {
  const project = { ...createProject("Template"), ...applyStrokeTemplate(strokeTemplates[0], "stable") };
  const settings = { ...project.strokeSettings, strategyParameters: { bend: .7 }, paintSimulation: { opacity: .8, wetMix: .4, pickup: .22, dragLengthMm: 15, dryingSeconds: 120, bristle: .3 } };
  const reopened = parseProject(serializeProject({ ...project, strokeSettings: settings }));
  assert.equal(reopened.strokeSettings.strategy, "flow-curves");
  assert.equal(reopened.strokeSettings.strategyParameters?.bend, .7);
  assert.deepEqual(reopened.strokeSettings.paintSimulation, settings.paintSimulation);
  assert.throws(() => strategyParameters("flow-curves", { turnLimit: NaN }));
  assert.throws(() => strategyParameters("flow-curves", { unknown: 10 }));
  assert.throws(() => parseProject(JSON.stringify({ ...project, strokeSettings: { ...settings, strategy: "unknown" } })));
});
test("v8 projects keep the original generator when migrating to templates", () => {
  const project = createProject("Old painting");
  const oldSettings = strokeStylePresets.realism.settings;
  const migrated = parseProject(JSON.stringify({ ...project, strokeSettings: oldSettings, version: 8 }));
  assert.equal(migrated.version, 14);
  assert.equal(migrated.strokeSettings.strategy, "legacy");
  const oldPlan = generateStyledStrokes("test", map, canvas, project.brush, { ...oldSettings, seed: "unchanged" });
  const migratedPlan = generateStyledStrokes("test", map, canvas, migrated.brush, { ...migrated.strokeSettings, seed: "unchanged" });
  assert.deepEqual(migratedPlan, oldPlan);
});

test("long continuous curves keep their short tail when split at maximum length", () => {
  const template = strokeTemplates.find(t => t.id === "decorative-lines")!;
  const plan = generateStyledStrokes("tails", { widthPx: 103, heightPx: 20, paintIds: ["red"], pixels: new Uint8Array(2060) },
    { widthMm: 103, heightMm: 20 }, { ...template.brush, widthMm: 2 }, { ...template.settings, seed: "tail",
      minStrokeLengthMm: 10, maxStrokeLengthMm: 50, strategyParameters: { amplitudeMm: 0, curl: 0, angle: 0, spacingMm: 10 } });
  const strokes = plan.operations.filter(op => op.type === "stroke");
  assert.ok(strokes.length >= 3);
  const row = strokes.filter(stroke => Math.abs(stroke.points[0].y - strokes[0].points[0].y) < 1e-6);
  assert.equal(row.length, 3);
  for (let i = 1; i < row.length; i++) assert.deepEqual(row[i - 1].points.at(-1), row[i].points[0]);
  assert.ok(row.at(-1)!.points.at(-1)!.x > 102, "The final 3 mm was not discarded");
});
