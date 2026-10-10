import test from "node:test";
import assert from "node:assert/strict";
import { detailPriorityMap, priorityDefaults, validatePriority, editableFocusMask, paintFocusMask, sampleFocusMask } from "../src/core/priority.ts";
import { generateStyledStrokes, type ColorRegionMap } from "../src/core/strokes.ts";
import { paintingStyleTemplates } from "../src/core/strokeTemplates.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
const canvas = { widthMm: 100, heightMm: 60 }, brush = { name: "Test", shape: "round" as const, widthMm: 4 };
const map: ColorRegionMap = { widthPx: 100, heightPx: 60, paintIds: ["paint"], pixels: new Uint8Array(6000), luminance: new Float32Array(6000).fill(.5) };
const base = { ...paintingStyleTemplates[0].settings, seed: "priority", minStrokeLengthMm: 4, maxStrokeLengthMm: 30, overlap: .3, strategyParameters: { imageInfluence: 0, bend: .8, angle: 0 } };
test("high pass favours coherent details and ignores flat surfaces and tiny noise", () => {
  assert.ok(detailPriorityMap(map, canvas, brush, { ...priorityDefaults, enabled: true }).every(v => v === 0));
  const source = Float32Array.from({ length: 6000 }, (_, i) => i % 100 < 40 ? .5 + .2 * Math.sin(i % 100 * .7) : .5);
  const priority = detailPriorityMap({ ...map, luminance: source }, canvas, brush, { ...priorityDefaults, enabled: true });
  assert.ok(priority[30 * 100 + 20] > .5);
  assert.equal(priority[30 * 100 + 90], 0);
  const noise = Float32Array.from({ length: 6000 }, (_, i) => .5 + (i % 2 ? .002 : -.002));
  assert.ok(detailPriorityMap({ ...map, luminance: noise }, canvas, brush, { ...priorityDefaults, enabled: true }).every(v => v === 0));
});
test("focus ellipse boosts the chosen subject but never masked pixels", () => {
  const pixels = map.pixels.slice(); pixels[30 * 100 + 30] = 255;
  const config = { ...priorityDefaults, enabled: true, focus: true, x: .3, width: .4, height: .8 };
  const priority = detailPriorityMap({ ...map, pixels }, canvas, brush, config);
  assert.equal(priority[30 * 100 + 30], 0);
  assert.ok(priority[29 * 100 + 30] > .9);
  assert.equal(priority[30 * 100 + 85], 0);
});
test("overlap increases actual flow stroke density instead of being cancelled by reservation", () => {
  const count = (overlap: number) => generateStyledStrokes("test", map, canvas, brush, { ...base, overlap }).operations.length;
  assert.ok(count(.7) > count(.1) * 1.5, `${count(.7)} vs ${count(.1)}`);
});
test("priority increases subject density while calming the quiet background", () => {
  const config = { ...priorityDefaults, enabled: true, focus: true, x: .3, width: .5, height: 1, strength: .8 };
  const plan = generateStyledStrokes("test", map, canvas, brush, { ...base, priority: config });
  assert.deepEqual(plan, generateStyledStrokes("test", map, canvas, brush, { ...base, priority: config }));
  const density = (left: boolean) => plan.operations.filter(op => op.type === "stroke" && (op.points[Math.floor(op.points.length / 2)].x < 50) === left).length;
  assert.ok(density(true) > density(false) * 1.2, `${density(true)} vs ${density(false)}`);
});

test("a freehand mask drives actual trajectory density and respects unpaintable pixels", () => {
  const mask = paintFocusMask(editableFocusMask(priorityDefaults, 100 / 60), { x: .25, y: .1 }, { x: .25, y: .9 }, .3, false);
  const config = { ...priorityDefaults, enabled: true, strength: .8, mask };
  const plan = generateStyledStrokes("painted", map, canvas, brush, { ...base, priority: config });
  const count = (left: boolean) => plan.operations.filter(op => op.type === "stroke" && (op.points[Math.floor(op.points.length / 2)].x < 50) === left).length;
  assert.ok(count(true) > count(false) * 1.2);
  const excluded = { ...map, pixels: new Uint8Array(map.pixels).fill(255, 0, 100) };
  assert.ok(detailPriorityMap(excluded, canvas, brush, config).slice(0, 100).every(v => v === 0));
});
test("short feature regions can be painted with the explicit detail minimum", () => {
  const pixels = new Uint8Array(6000).fill(255);
  for (let y = 15; y < 45; y++) for (let x = 30; x < 35; x++) pixels[y * 100 + x] = 0;
  const input = { ...map, pixels };
  const settings = { ...base, minStrokeLengthMm: 12, strategyParameters: { angle: 0, imageInfluence: 0, bend: 0 } };
  assert.equal(generateStyledStrokes("short", input, canvas, brush, settings).operations.length, 0);
  const priority = { ...priorityDefaults, enabled: true, focus: true, x: .325, width: .4, height: 1 };
  const plan = generateStyledStrokes("short", input, canvas, brush, { ...settings, priority });
  assert.ok(plan.operations.length > 0);
  for (const op of plan.operations) if (op.type === "stroke") for (const q of op.points) assert.equal(pixels[Math.floor(q.y) * 100 + Math.floor(q.x)], 0);
});
test("priority persists; previous projects keep the feature disabled", () => {
  const project = createProject(), priority = { ...priorityDefaults, enabled: true, focus: true, x: .7 };
  const saved = parseProject(serializeProject({ ...project, strokeSettings: { ...project.strokeSettings, priority } }));
  assert.deepEqual(saved.strokeSettings.priority, priority);
  assert.equal(parseProject(JSON.stringify({ ...project, version: 10 })).strokeSettings.priority?.enabled, false);
  assert.throws(() => validatePriority({ ...priority, x: Infinity }));
});

test("painted mask has soft edges, continuous paths and supports erasing", () => {
  const empty = editableFocusMask(priorityDefaults, 2);
  const painted = paintFocusMask(empty, { x: .2, y: .5 }, { x: .8, y: .5 }, .12, false);
  assert.ok(sampleFocusMask(painted, .5, .5) > .99);
  const edge = sampleFocusMask(painted, .5, .57);
  assert.ok(edge > 0 && edge < .8);
  assert.equal(sampleFocusMask(painted, .5, .8), 0);
  assert.ok(empty.values.every(v => v === 0));
  const erased = paintFocusMask(painted, { x: .5, y: .3 }, { x: .5, y: .7 }, .12, true);
  assert.ok(sampleFocusMask(erased, .5, .5) < .01);
  assert.ok(sampleFocusMask(erased, .25, .5) > .99);
  const config = { ...priorityDefaults, enabled: true, mask: painted };
  const project = createProject();
  assert.deepEqual(parseProject(serializeProject({ ...project, strokeSettings: { ...project.strokeSettings, priority: config } })).strokeSettings.priority, config);
  assert.throws(() => validatePriority({ ...config, mask: { width: 192, height: 96, values: [255] } }));
  assert.throws(() => validatePriority({ ...config, mask: { width: 1, height: 1, values: [Infinity] } }));
  const priority = detailPriorityMap(map, canvas, brush, config);
  assert.ok(priority[30 * 100 + 50] > .97);
  assert.ok(Math.abs(priority[30 * 100 + 50] - sampleFocusMask(painted, .505, 30.5 / 60)) < 1e-6);
  assert.equal(priority[55 * 100 + 50], 0);
});

test("opening an old ellipse in the editor retains its selection", () => {
  const ellipse = { ...priorityDefaults, focus: true };
  const mask = editableFocusMask(ellipse, 1);
  assert.ok(sampleFocusMask(mask, .5, .5) > .99);
  assert.equal(sampleFocusMask(mask, .05, .05), 0);
});

test("manual-only priority excludes detected texture, combines when enabled and survives reload", () => {
  const source = { ...map, luminance: Float32Array.from({ length: 6000 }, (_, i) => i % 100 < 40 ? .5 + .2 * Math.sin(i % 100 * .7) : .5) };
  const mask = paintFocusMask(editableFocusMask(priorityDefaults, 100 / 60), { x: .75, y: .3 }, { x: .75, y: .7 }, .15, false);
  const config = { ...priorityDefaults, enabled: true, automatic: false, mask };
  const manual = detailPriorityMap(source, canvas, brush, config);
  const combined = detailPriorityMap(source, canvas, brush, { ...config, automatic: true });
  assert.equal(manual[30 * 100 + 20], 0);
  assert.ok(combined[30 * 100 + 20] > .5);
  assert.ok(manual[30 * 100 + 75] > .98);
  assert.deepEqual(detailPriorityMap({ ...source, luminance: undefined }, canvas, brush, config), manual);
  assert.ok(detailPriorityMap(source, canvas, brush, { ...config, mask: undefined }).every(v => v === 0));
  const generate = (input: typeof map) => generateStyledStrokes("manual", input, canvas, brush, { ...base, priority: config });
  assert.deepEqual(generate(source), generate(map)); // imageInfluence = 0; photo texture cannot add priority.
  const project = createProject();
  const reopened = parseProject(serializeProject({ ...project, strokeSettings: { ...project.strokeSettings, priority: config } }));
  assert.deepEqual(reopened.strokeSettings.priority, config);
  const { automatic: _, ...old } = config;
  assert.equal(parseProject(JSON.stringify({ ...project, version: 13, strokeSettings: { ...project.strokeSettings, priority: old } })).strokeSettings.priority?.automatic, true);
  assert.throws(() => validatePriority({ ...config, automatic: "false" }));
});

test("priority keeps the original base curves and adds strokes only inside important areas", () => {
  const source = { ...map, luminance: Float32Array.from({ length: 6000 }, (_, i) => .5 + .2 * Math.sin(i % 100 * .14 + Math.floor(i / 100) * .09)) };
  const settings = { ...base, strategyParameters: { imageInfluence: 1, bend: .5, angle: 20 } };
  const original = generateStyledStrokes("stable", source, canvas, brush, settings);
  const mask = paintFocusMask(editableFocusMask(priorityDefaults, 100 / 60), { x: .25, y: .3 }, { x: .25, y: .7 }, .25, false);
  const priority = { ...priorityDefaults, enabled: true, automatic: false, mask };
  const augmented = generateStyledStrokes("stable", source, canvas, brush, { ...settings, priority });
  assert.deepEqual(augmented.operations.slice(0, original.operations.length), original.operations);
  assert.ok(augmented.operations.length > original.operations.length);
  const importance = detailPriorityMap(source, canvas, brush, priority);
  for (const stroke of augmented.operations.slice(original.operations.length)) if (stroke.type === "stroke") for (const p of stroke.points) {
    assert.ok(importance[Math.floor(p.y) * 100 + Math.floor(p.x)] > .05);
  }
  assert.deepEqual(generateStyledStrokes("stable", source, canvas, brush, { ...settings, priority: { ...priority, mask: undefined } }).operations, original.operations);
  const simplified = generateStyledStrokes("stable", source, canvas, brush, { ...settings, priority: { ...priority, simplifyBackground: true } });
  assert.notDeepEqual(simplified.operations.slice(0, original.operations.length), original.operations);
  const { simplifyBackground: _, ...old } = priority;
  assert.equal(validatePriority(old).simplifyBackground, false);
});
