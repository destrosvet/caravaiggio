import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { imagePalette } from "../core/imagePalette.ts";
import { nearestPaletteIndex, hexToRgb } from "../core/color.ts";
import { generateStyledStrokes } from "../core/strokes.ts";
import { strokeTemplates } from "../core/strokeTemplates.ts";
import { evaluateTrajectories } from "../core/trajectoryEvaluation.ts";
import { strokePreviewTimeline } from "../core/strokePreview.ts";
import { defaultWorkspace } from "../core/workspace.ts";
import { renderPaintTimeline } from "../core/paintRaster.ts";
import { encodePng } from "./png.ts";
import { medianFilterPixels } from "../core/medianFilter.ts";
const out = resolve(process.argv[2] ?? "artifacts/photos"), input = resolve("artifacts/photo-inputs");
await mkdir(out, { recursive: true });
const template = strokeTemplates.find(t => t.id === "flow-curves")!;
const brush = { ...template.brush, widthMm: Number(process.argv[3] ?? template.brush.widthMm) };
const settings = { ...template.settings, seed: "photo-regression", minStrokeLengthMm: Number(process.argv[4] ?? template.settings.minStrokeLengthMm), overlap: Number(process.argv[5] ?? template.settings.overlap) };
const medianRadiusMm = Number(process.argv[6] ?? 0);
const report = [];
for (const filename of (await readdir(input)).filter(name => name.endsWith(".json")).sort()) {
  const photo = JSON.parse(await readFile(resolve(input, filename), "utf8"));
  const width = photo.width as number, height = photo.height as number;
  const source = new Uint8ClampedArray(photo.rgba);
  const canvas = { widthMm: 400 * width / height, heightMm: 400 };
  const filtered = medianFilterPixels(source, width, height, canvas, medianRadiusMm);
  const palette = imagePalette(new Uint8ClampedArray(photo.sample), 8).map((hex, i) => ({ id: `paint-${i}`, name: `Photo ${i}`, hex, skipPainting: false }));
  const pixels = new Uint8Array(width * height), luminance = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const rgb = { r: filtered[i * 4], g: filtered[i * 4 + 1], b: filtered[i * 4 + 2] };
    pixels[i] = source[i * 4 + 3] < 16 ? 255 : nearestPaletteIndex(rgb, palette);
    luminance[i] = (.2126 * source[i * 4] + .7152 * source[i * 4 + 1] + .0722 * source[i * 4 + 2]) / 255;
  }
  const map = { widthPx: width, heightPx: height, pixels, luminance, paintIds: palette.map(p => p.id), palette, sourceRgba: source };
  const plan = generateStyledStrokes(filename, map, canvas, brush, settings);
  const evaluated = evaluateTrajectories(plan, map, canvas, brush);
  const { timeline, origin } = strokePreviewTimeline(plan, canvas, palette, defaultWorkspace(canvas), 140, brush.widthMm);
  const raster = renderPaintTimeline(timeline, canvas, brush, palette, width * 2, height * 2, undefined, undefined, origin);
  const target = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => { const rgb = p === 255 ? { r: 255, g: 255, b: 255 } : hexToRgb(palette[p].hex); target.set([rgb.r, rgb.g, rgb.b, 255], i * 4); });
  const stem = filename.slice(0, -5);
  await writeFile(resolve(out, `${stem}-source.png`), encodePng(width, height, source));
  await writeFile(resolve(out, `${stem}-target.png`), encodePng(width, height, target));
  await writeFile(resolve(out, `${stem}-painting.png`), encodePng(width * 2, height * 2, raster.rgba));
  const paths = plan.operations.filter(op => op.type === "stroke").map(op => `<polyline points="${op.points.map(p => `${p.x},${p.y}`).join(" ")}"/>`).join("");
  await writeFile(resolve(out, `${stem}-paths.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.widthMm} ${canvas.heightMm}"><rect width="100%" height="100%" fill="#111"/><g fill="none" stroke="#E6D39B" stroke-width=".25">${paths}</g></svg>`);
  const row = { name: photo.name, canvas, brush, settings, medianRadiusMm, palette, ...evaluated.metrics, omitted: plan.generationStats?.omittedShortStrokes, meanPaintCoverage: raster.coverage.reduce((a, b) => a + b, 0) / raster.coverage.length };
  report.push(row); console.log(JSON.stringify({ name: row.name, coverage: row.coverage, accuracy: row.accuracy, omitted: row.omitted, strokes: row.strokes, meanPaintCoverage: row.meanPaintCoverage }));
}
await writeFile(resolve(out, "report.json"), JSON.stringify(report, null, 2));
await writeFile(resolve(out, "index.html"), `<!doctype html><html lang="cs"><meta charset="utf-8"><title>Flow curves – referenční fotografie</title><style>body{background:#171713;color:#e4ddcc;font:15px system-ui;margin:24px}.images{display:flex;gap:12px;align-items:flex-start}figure{margin:0;flex:1;min-width:0}img{width:100%}section{margin:30px 0}figcaption{padding:8px 0}</style><h1>Flow curves – referenční fotografie</h1><p>Štětec ${brush.widthMm} mm · minimum ${settings.minStrokeLengthMm} mm · překryv ${settings.overlap}. Výška plátna 400 mm, poměr stran podle fotky. Paleta 8 barev, pevný seed. Pillow zmenšuje vstup; výsledek se může mírně lišit od dekódování a transformace ve webu.</p>${report.map(row => {
  const stem = row.name.replace(/\.[^.]+$/, "");
  return `<section><h2>${row.name}</h2><p>${row.strokes} tahů · vynechaných krátkých tahů ${row.omitted} · průměrná vrstva pigmentu ${(row.meanPaintCoverage * 100).toFixed(1)} % · geometrická shoda barvy ${(row.accuracy * 100).toFixed(1)} %</p><div class="images">${["source.png", "target.png", "painting.png", "paths.svg"].map((suffix, i) => `<figure><img src="${stem}-${suffix}"><figcaption>${["Fotka", "Paleta", "Pixelová malba", "Trajektorie"][i]}</figcaption></figure>`).join("")}</div></section>`;
}).join("")}</html>`);
