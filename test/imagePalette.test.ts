import assert from "node:assert/strict";
import test from "node:test";
import { imagePalette } from "../src/core/imagePalette.ts";
const pixels = (colors: readonly (readonly number[])[]) => new Uint8ClampedArray(colors.flatMap(color => Array.from({ length: 100 }, () => [...color, 255]).flat()));
test("initial palette represents four main photo colours deterministically", () => {
  const input = pixels([[45, 100, 35], [155, 110, 90], [240, 235, 220], [25, 25, 20]]);
  const palette = imagePalette(input);
  assert.equal(palette.length, 4);
  assert.deepEqual(new Set(palette), new Set(["#2D6423", "#9B6E5A", "#F0EBDC", "#191914"]));
  assert.deepEqual(imagePalette(input), palette);
});
test("locked colours reserve palette slots", () => {
  const input = pixels([[255, 0, 0], [0, 0, 255], [0, 255, 0], [255, 255, 255]]);
  const palette = imagePalette(input, 4, ["#FF0000"]);
  assert.equal(palette.length, 3);
  assert.ok(!palette.includes("#FF0000"));
});
test("monochrome and transparent images do not invent duplicate colours", () => {
  assert.deepEqual(imagePalette(pixels([[100, 100, 100]])), ["#646464"]);
  assert.deepEqual(imagePalette(new Uint8ClampedArray([255, 0, 0, 0, 0, 255, 0, 0])), []);
  assert.deepEqual(imagePalette(pixels([[0, 0, 0]]), 1, ["#FFFFFF"]), []);
});
