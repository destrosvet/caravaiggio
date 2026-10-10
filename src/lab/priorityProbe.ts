import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateStyledStrokes } from "../core/strokes.ts";
import { priorityDefaults, detailPriorityMap } from "../core/priority.ts";
import { paintingStyleTemplates } from "../core/strokeTemplates.ts";
import { hexToRgb } from "../core/color.ts";
import { strokePreviewTimeline } from "../core/strokePreview.ts";
import { defaultWorkspace } from "../core/workspace.ts";
import { renderPaintTimeline } from "../core/paintRaster.ts";
import { encodePng } from "./png.ts";
const width = 100, height = 120, canvas = { widthMm: 160, heightMm: 192 }, brush = { name: "Probe", shape: "flat" as const, widthMm: 6 };
const palette = [
  { id: "background", hex: "#C7AC60", name: "Background", skipPainting: false },
  { id: "shirt", hex: "#596775", name: "Shirt", skipPainting: false },
  { id: "skin", hex: "#BC8D73", name: "Skin", skipPainting: false },
  { id: "detail", hex: "#654838", name: "Detail", skipPainting: false },
];
const pixels = new Uint8Array(width * height), luminance = new Float32Array(width * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const body = ((x - 66) / 25) ** 2 + ((y - 85) / 40) ** 2 < 1;
  const head = ((x - 67) / 14) ** 2 + ((y - 36) / 19) ** 2 < 1;
  const paint = head ? (y > 32 && y < 35 || y > 45 && y < 48 ? 3 : 2) : body ? 1 : 0;
  const i = y * width + x; pixels[i] = paint;
  const rgb = hexToRgb(palette[paint].hex), light = (.2126 * rgb.r + .7152 * rgb.g + .0722 * rgb.b) / 255;
  luminance[i] = Math.max(0, Math.min(1, light + (body || head ? .06 * Math.sin(x * .8 + y * .3) : .005 * Math.sin(x * .1))));
}
const map = { widthPx: width, heightPx: height, paintIds: palette.map(p => p.id), pixels, luminance, palette };
const config = { ...priorityDefaults, enabled: true, focus: true, x: .66, y: .57, width: .6, height: .85, strength: .8 };
const importance = detailPriorityMap(map, canvas, brush, config);
const paintWidth = width * 2, paintHeight = height * 2, rgba = new Uint8ClampedArray(paintWidth * 4 * paintHeight * 4);
for (let y = 0; y < paintHeight; y++) for (let x = 0; x < paintWidth; x++) {
  const i = Math.floor(y / 2) * width + Math.floor(x / 2), rgb = hexToRgb(palette[pixels[i]].hex), v = importance[i];
  rgba.set([rgb.r, rgb.g, rgb.b, 255], (y * paintWidth * 4 + x) * 4);
  rgba.set([25 + v * 230, 25 + v * 135, 30 * (1 - v), 255], (y * paintWidth * 4 + paintWidth * 2 + x) * 4);
}
const out = resolve("artifacts/priority-probe"); await mkdir(out, { recursive: true });
const metrics: { enabled: boolean; strokes: number; subjectCoverage: number; backgroundCoverage: number }[] = [];
for (const enabled of [false, true]) {
  const settings = { ...paintingStyleTemplates[0].settings, seed: "priority-probe", overlap: .45, minStrokeLengthMm: 10, maxStrokeLengthMm: 55,
    strategyParameters: { bend: .8, imageInfluence: .7 }, priority: { ...config, enabled } };
  const plan = generateStyledStrokes("probe", map, canvas, brush, settings);
  const { timeline, origin } = strokePreviewTimeline(plan, canvas, palette, defaultWorkspace(canvas), 120, brush.widthMm);
  const raster = renderPaintTimeline(timeline, canvas, brush, palette, paintWidth, paintHeight, undefined, undefined, origin);
  let subject = 0, background = 0, ns = 0, nb = 0;
  for (let y = 0; y < paintHeight; y++) for (let x = 0; x < paintWidth; x++) {
    const i = y * paintWidth + x, source = Math.floor(y / 2) * width + Math.floor(x / 2);
    if (pixels[source]) { subject += raster.coverage[i]; ns++; } else { background += raster.coverage[i]; nb++; }
  }
  metrics.push({ enabled, strokes: plan.operations.length, subjectCoverage: subject / ns, backgroundCoverage: background / nb });
  for (let y = 0; y < paintHeight; y++) rgba.set(raster.rgba.subarray(y * paintWidth * 4, (y + 1) * paintWidth * 4), (y * paintWidth * 4 + (enabled ? 3 : 1) * paintWidth) * 4);
  const paths = plan.operations.filter(op => op.type === "stroke").map(op => op.type === "stroke" ? `<polyline points="${op.points.map(p => `${p.x},${p.y}`).join(" ")}"/>` : "").join("");
  await writeFile(resolve(out, `${enabled ? "after" : "before"}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 192"><rect width="160" height="192" fill="#111"/><g fill="none" stroke="#E6D39B" stroke-width=".25">${paths}</g></svg>`);
}
await writeFile(resolve(out, "comparison.png"), encodePng(paintWidth * 4, paintHeight, rgba));
await writeFile(resolve(out, "metrics.json"), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics));
if (metrics[1].subjectCoverage <= metrics[0].subjectCoverage) throw new Error("Priority did not improve subject coverage.");
