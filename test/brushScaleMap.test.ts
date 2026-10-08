import assert from "node:assert/strict";
import test from "node:test";
import { brushScaleMap } from "../src/core/brushScaleMap.ts";
test("brush scale filtering removes isolated speckles and preserves unpainted masks", () => {
  const map = { widthPx: 30, heightPx: 30, paintIds: ["gold", "brown"], pixels: new Uint8Array(900) };
  map.pixels[15 * 30 + 15] = 1; map.pixels[0] = 255;
  const result = brushScaleMap(map, { widthMm: 100, heightMm: 100 }, 10);
  assert.equal(result.pixels[15 * 30 + 15], 0);
  assert.equal(result.pixels[0], 255);
  assert.equal(map.pixels[15 * 30 + 15], 1);
});
test("large coherent colour areas survive physical brush simplification", () => {
  const map = { widthPx: 30, heightPx: 30, paintIds: ["gold", "brown"], pixels: new Uint8Array(900) };
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) map.pixels[y * 30 + x] = 1;
  const result = brushScaleMap(map, { widthMm: 100, heightMm: 100 }, 10);
  assert.equal(result.pixels[15 * 30 + 15], 1);
  assert.equal(result.pixels[5 * 30 + 5], 0);
});
