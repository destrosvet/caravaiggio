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

test("muted foliage uses available green paints instead of beige or brown mixtures", () => {
  const palette = ["#F4F0E6", "#1B1918", "#3EEE11", "#33BB36", "#5342F0", "#C7A86C", "#746348", "#6D654A"];
  // Sampled from the supplied photograph: sunlit, muted and shaded foliage.
  for (const source of [{ r: 149, g: 157, b: 48 }, { r: 116, g: 127, b: 48 }, { r: 98, g: 115, b: 46 }]) {
    assert.deepEqual(nearestPaletteColor(source, palette), { r: 51, g: 187, b: 54 });
  }
  const skin = nearestPaletteColor({ r: 163, g: 110, b: 96 }, palette);
  assert.ok(skin.r > skin.g && skin.g > skin.b);
  const neutral = nearestPaletteColor({ r: 180, g: 180, b: 180 }, palette);
  assert.notDeepEqual(neutral, { r: 51, g: 187, b: 54 });
});

test("hue family preference respects accent restrictions and falls back when no family exists", () => {
  const source = { r: 98, g: 115, b: 46 };
  assert.deepEqual(nearestPaletteColor(source, ["#C7A86C", { hex: "#33BB36", restricted: true, hueToleranceDeg: 1 }]), { r: 199, g: 168, b: 108 });
  assert.deepEqual(nearestPaletteColor(source, ["#C7A86C"]), { r: 199, g: 168, b: 108 });
});
