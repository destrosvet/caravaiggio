import test from "node:test";
import assert from "node:assert/strict";
import { medianFilterPixels } from "../src/core/medianFilter.ts";
import { createProject, serializeProject, parseProject } from "../src/project/model.ts";

test("median removes isolated spots, preserves a strong edge and leaves alpha masks unchanged", () => {
  const width = 15, height = 9, source = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) source.set(x < 8 ? [210, 140, 90, 255] : [40, 60, 70, 255], (y * width + x) * 4);
  source.set([0, 0, 0, 255], (4 * width + 4) * 4);
  source.set([255, 255, 255, 0], (4 * width + 12) * 4);
  const result = medianFilterPixels(source, width, height, { widthMm: 15, heightMm: 9 }, 1);
  assert.deepEqual(Array.from(result.slice((4 * width + 4) * 4, (4 * width + 4) * 4 + 4)), [210, 140, 90, 255]);
  for (const x of [7, 8]) assert.deepEqual(result.slice((4 * width + x) * 4, (4 * width + x) * 4 + 4), source.slice((4 * width + x) * 4, (4 * width + x) * 4 + 4));
  assert.deepEqual(result.slice((4 * width + 12) * 4, (4 * width + 12) * 4 + 4), source.slice((4 * width + 12) * 4, (4 * width + 12) * 4 + 4));
  assert.equal(source[(4 * width + 4) * 4], 0);
  assert.equal(medianFilterPixels(source, width, height, { widthMm: 15, heightMm: 9 }, 0), source);
});

test("sliding median agrees with a separate sorted-kernel oracle at edges and masked pixels", () => {
  const width = 19, height = 11, canvas = { widthMm: 19, heightMm: 5.5 };
  const source = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? (Math.floor(i / 4) % 7 ? 255 : 0) : (i * 73 + Math.floor(i / 17) * 43) % 256);
  for (const radius of [1, 2, 8]) {
    const rx = Math.min(width - 1, radius), ry = Math.min(height - 1, radius * 2), expected = new Uint8ClampedArray(source);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4; if (source[offset + 3] < 16) continue;
      for (let c = 0; c < 3; c++) {
        const values: number[] = [];
        for (let yy = Math.max(0, y - ry); yy <= Math.min(height - 1, y + ry); yy++) for (let xx = Math.max(0, x - rx); xx <= Math.min(width - 1, x + rx); xx++) {
          const j = (yy * width + xx) * 4; if (source[j + 3] >= 16) values.push(source[j + c]);
        }
        values.sort((a, b) => a - b); expected[offset + c] = values[Math.floor(values.length / 2)];
      }
    }
    assert.deepEqual(medianFilterPixels(source, width, height, canvas, radius), expected);
  }
});

test("median settings persist, old projects default to off and invalid radii are rejected", () => {
  const project = createProject();
  const edited = { ...project, posterization: { ...project.posterization, medianRadiusMm: 2 } };
  assert.equal(parseProject(serializeProject(edited)).posterization.medianRadiusMm, 2);
  const { medianRadiusMm: _, ...old } = project.posterization;
  assert.equal(parseProject(JSON.stringify({ ...project, version: 12, posterization: old })).posterization.medianRadiusMm, 0);
  for (const radius of [-1, 9, "2", null]) assert.throws(() => parseProject(JSON.stringify({ ...project, posterization: { ...old, medianRadiusMm: radius } })));
});
