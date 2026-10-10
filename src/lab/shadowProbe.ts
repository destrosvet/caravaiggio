import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hexToRgb } from "../core/color.ts";
import { generateStyledStrokes } from "../core/strokes.ts";
import { paintingStyleTemplates } from "../core/strokeTemplates.ts";
import { shadowDefaults } from "../core/shadows.ts";
import { strokePreviewTimeline } from "../core/strokePreview.ts";
import { defaultWorkspace } from "../core/workspace.ts";
import { renderPaintTimeline, paintSimulationDefaults } from "../core/paintRaster.ts";
import { encodePng } from "./png.ts";

const width = 160, height = 120, canvas = { widthMm: 160, heightMm: 120 };
const palette = [
  { id: "skin", name: "Skin", hex: "#BE9E85", skipPainting: false },
  { id: "shirt", name: "Blue shirt", hex: "#496071", skipPainting: false },
  { id: "earth", name: "Earth shadow", hex: "#483025", skipPainting: false },
  { id: "navy", name: "Navy shadow", hex: "#111C28", skipPainting: false },
];
const pixels = new Uint8Array(width * height), luminance = new Float32Array(width * height), sourceRgba = new Uint8ClampedArray(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const i = y * width + x, region = y < 65 ? 0 : 1; pixels[i] = region;
  const rgb = hexToRgb(palette[region].hex);
  const shadow = region === 0 ? .55 * Math.exp(-(((x - 82) / 40) ** 2) - ((y - 48) / 12) ** 2)
    : .5 * Math.exp(-(((x - 90 - (y - 70) * .6) / 14) ** 2));
  const colour = [rgb.r, rgb.g, rgb.b].map(v => v * (1 - shadow));
  sourceRgba.set([...colour, 255], i * 4);
  luminance[i] = (.2126 * colour[0] + .7152 * colour[1] + .0722 * colour[2]) / 255;
}
const map = { widthPx: width, heightPx: height, paintIds: palette.map(p => p.id), pixels, luminance, palette, sourceRgba };
const preset = paintingStyleTemplates[0], brush = { ...preset.brush, widthMm: 5 };
const out = resolve("artifacts/shadow-probe"); await mkdir(out, { recursive: true });
const comparison = new Uint8ClampedArray(width * 3 * height * 4);
for (let y = 0; y < height; y++) comparison.set(sourceRgba.subarray(y * width * 4, (y + 1) * width * 4), y * width * 3 * 4);
const metrics: { enabled: boolean; strokes: number; tonalRmse: number }[] = [];
for (const enabled of [false, true]) {
  const plan = generateStyledStrokes("probe", map, canvas, brush, { ...preset.settings, seed: "shadow-probe", pressure: .85, overlap: .65,
    strategyParameters: { imageInfluence: 0, bend: 0, angle: 0 }, shadows: { ...shadowDefaults, enabled, strength: .65 } });
  const { timeline, origin } = strokePreviewTimeline(plan, canvas, palette, defaultWorkspace(canvas), 120, brush.widthMm);
  const raster = renderPaintTimeline(timeline, canvas, brush, palette, width, height, { ...paintSimulationDefaults, opacity: 1 }, undefined, origin);
  let error = 0;
  for (let i = 0; i < pixels.length; i++) { const light = (.2126 * raster.rgba[i * 4] + .7152 * raster.rgba[i * 4 + 1] + .0722 * raster.rgba[i * 4 + 2]) / 255; error += (light - luminance[i]) ** 2; }
  metrics.push({ enabled, strokes: plan.shadowStats?.strokes ?? 0, tonalRmse: Math.sqrt(error / pixels.length) });
  for (let y = 0; y < height; y++) comparison.set(raster.rgba.subarray(y * width * 4, (y + 1) * width * 4), (y * width * 3 + (enabled ? 2 : 1) * width) * 4);
}
await writeFile(resolve(out, "comparison.png"), encodePng(width * 3, height, comparison));
await writeFile(resolve(out, "metrics.json"), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics));
if (!metrics[1].strokes || metrics[1].tonalRmse >= metrics[0].tonalRmse) throw new Error("Shadow probe did not improve source tonal error.");
