import assert from "node:assert/strict";
import test from "node:test";
import { hexToHsl, hslToHex, nearestPaletteColor, perceptualPaintDistance, posterizePixels, rgbToOklab } from "../src/core/color.ts";

test("nearest palette matching uses an available color", () => {
  assert.deepEqual(nearestPaletteColor({ r: 240, g: 20, b: 20 }, ["#FF0000", "#0000FF"]), { r: 255, g: 0, b: 0 });
});

test("posterization preserves alpha and only emits palette colors", () => {
  const output = posterizePixels(new Uint8ClampedArray([250, 5, 5, 120, 5, 5, 250, 255]), ["#FF0000", "#0000FF"]);
  assert.deepEqual([...output], [255, 0, 0, 120, 0, 0, 255, 255]);
});

test("neutral fur is protected from a similarly light saturated paint", () => {
  const neutral = { r: 205, g: 198, b: 190 };
  const result = nearestPaletteColor(neutral, ["#E8E1D3", "#D77FAE"]);
  assert.deepEqual(result, { r: 232, g: 225, b: 211 });
});

test("hue and chroma differences matter more than a small lightness advantage", () => {
  const source = rgbToOklab({ r: 181, g: 122, b: 90 });
  const brown = rgbToOklab({ r: 157, g: 91, b: 63 });
  const pink = rgbToOklab({ r: 206, g: 121, b: 166 });
  assert.ok(perceptualPaintDistance(source, brown) < perceptualPaintDistance(source, pink));
});

test("a restricted accent color is excluded outside its hue tolerance", () => {
  const result = nearestPaletteColor({ r: 190, g: 135, b: 105 }, [
    { hex: "#9D5B3F" },
    { hex: "#D779A6", restricted: true, hueToleranceDeg: 25, minimumChroma: 0.04 },
  ]);
  assert.deepEqual(result, { r: 157, g: 91, b: 63 });
});

test("HSL controls preserve a color through conversion", () => {
  const hsl = hexToHsl("#D779A6");
  const original = [0xD7, 0x79, 0xA6];
  const converted = hslToHex(...hsl).slice(1).match(/../g)?.map((value) => Number.parseInt(value, 16)) ?? [];
  assert.ok(converted.every((value, index) => Math.abs(value - original[index]) <= 1));
});
