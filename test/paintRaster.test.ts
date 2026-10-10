import test from "node:test";
import assert from "node:assert/strict";
import mixbox from "mixbox";
import { PaintRaster, paintSimulationDefaults, validatePaintSimulation } from "../src/core/paintRaster.ts";
const palette = [{ id: "blue", hex: "#002185" }, { id: "yellow", hex: "#FCD300" }];
const make = (pickup: number) => new PaintRaster(80, 40, { widthMm: 80, heightMm: 40 }, { name: "Test", shape: "round", widthMm: 12 }, palette,
  { ...paintSimulationDefaults, opacity: 1, pickup, dragLengthMm: 70, bristle: 0 });
const paint = (raster: PaintRaster) => {
  raster.stroke({ x: 30, y: 1 }, { x: 30, y: 39 }, "blue", 1, 1, 1, 0, 1);
  raster.load("yellow");
  raster.stroke({ x: 5, y: 20 }, { x: 75, y: 20 }, "yellow", 1, 1, 1, 2, 3);
};
test("Mixbox blue and yellow produce a green pigment mix", () => {
  const [r, g, b] = mixbox.lerp([0, 33, 133], [252, 211, 0], .5);
  assert.ok(g > r && g > b);
});
test("pixel simulation is deterministic and pickup carries colour beyond the overlap", () => {
  const a = make(.8), b = make(.8), noPickup = make(0); paint(a); paint(b); paint(noPickup);
  assert.deepEqual(a.rgba, b.rgba);
  const pixel = (20 * 80 + 48) * 4;
  assert.notDeepEqual(Array.from(a.rgba.slice(pixel, pixel + 3)), Array.from(noPickup.rgba.slice(pixel, pixel + 3)));
});
test("clone for partial playback does not mutate committed paint or brush state", () => {
  const raster = make(.3); paint(raster); const before = raster.rgba.slice();
  const copy = raster.clone(); copy.stroke({ x: 10, y: 2 }, { x: 70, y: 2 }, "blue", 1, 1, 1, 4, 5);
  assert.deepEqual(raster.rgba, before);
  assert.notDeepEqual(copy.rgba, before);
});
test("zero pressure paints nothing and invalid simulation controls are rejected", () => {
  const raster = make(0), before = raster.rgba.slice(); raster.stroke({ x: 0, y: 20 }, { x: 80, y: 20 }, "blue", 0, 1, 1, 0, 1);
  assert.deepEqual(raster.rgba, before);
  assert.throws(() => validatePaintSimulation({ pickup: 2 }));
});
test("wet blending retains underlying pigment more than dry overpainting", () => {
  const render = (wetMix: number) => {
    const raster = new PaintRaster(80, 40, { widthMm: 80, heightMm: 40 }, { name: "Test", shape: "round", widthMm: 12 }, palette,
      { ...paintSimulationDefaults, opacity: 1, pickup: 0, wetMix, bristle: 0 });
    for (let i = 0; i < 4; i++) raster.stroke({ x: 30, y: 1 }, { x: 30, y: 39 }, "blue", 1, 1, 1, i, i + 1);
    raster.load("yellow"); raster.stroke({ x: 5, y: 20 }, { x: 75, y: 20 }, "yellow", 1, 1, 1, 4, 5);
    return raster.rgba.slice((20 * 80 + 30) * 4, (20 * 80 + 30) * 4 + 3);
  };
  const dry = render(0), wet = render(1);
  assert.ok(wet[0] < dry[0]);
  assert.notDeepEqual(wet, dry);
});

test("subdividing a straight stroke preserves continuous bristle texture", () => {
  const makeStroke = (segments: number) => {
    const raster = new PaintRaster(240, 80, { widthMm: 120, heightMm: 40 }, { name: "Flat", shape: "flat", widthMm: 10 }, palette,
      { ...paintSimulationDefaults, pickup: 0, bristle: .65 });
    for (let i = 0; i < segments; i++) raster.stroke({ x: 10 + 100 * i / segments, y: 20 }, { x: 10 + 100 * (i + 1) / segments, y: 20 },
      "blue", .7, 1, 1, i / segments, (i + 1) / segments);
    return raster;
  };
  const whole = makeStroke(1), split = makeStroke(100);
  let error = 0;
  for (let i = 0; i < whole.rgba.length; i++) error += Math.abs(whole.rgba[i] - split.rgba[i]);
  assert.ok(error / whole.rgba.length < 1, `Subdivision error ${error / whole.rgba.length}`);
  const centre = Array.from({ length: 14 }, (_, i) => split.coverage[(33 + i) * split.width + 120]);
  assert.ok(Math.max(...centre) - Math.min(...centre) > .1, "Bristle grooves remain visible inside the stroke");
});
