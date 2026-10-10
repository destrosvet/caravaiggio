import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { evaluateTrajectories } from "./core/trajectoryEvaluation.ts";
import { generateStyledStrokes, strokeStylePresets } from "./core/strokes.ts";
import type { ColorRegionMap, BrushProfile, StrokeGenerationSettings } from "./core/strokes.ts";
import type { PaintingPlan } from "./core/model.ts";
import { defaultWorkspace, syncWorkspace } from "./core/workspace.ts";
import { buildSimulation } from "./core/simulation.ts";
import { optimizeStrokeOrder } from "./core/strokeOrdering.ts";
import { strokeTemplates } from "./core/strokeTemplates.ts";
import { renderPaintTimeline, PaintRaster, paintSimulationDefaults, rgbFromHex } from "./core/paintRaster.ts";
import { encodePng } from "./lab/png.ts";

type Fixture = { name: string; map: ColorRegionMap; canvas: { widthMm: number; heightMm: number }; brush?: BrushProfile; settings?: Partial<StrokeGenerationSettings>; plan?: PaintingPlan; palette?: readonly { id: string; hex: string }[] };
const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const i = args.indexOf(name); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Missing value for ${name}`); return args[i + 1]; };
const known = new Set(["--out", "--input", "--baseline", "--style", "--template", "--seed", "--tolerance", "--help"]);
for (let i = 0; i < args.length; i++) { if (!known.has(args[i])) throw new Error(`Unknown argument ${args[i]}`); if (args[i] !== "--help") i++; }
if (args.includes("--help")) {
  console.log("node --experimental-strip-types src/trajectoryLab.ts [--out artifacts/trajectory-lab] [--style realism|all] [--template flow-curves|all] [--seed lab-v1] [--input fixture.json] [--baseline report.json] [--tolerance 0.01]");
  process.exit(0);
}
const out = resolve(option("--out", "artifacts/trajectory-lab")!);
const style = option("--style", "realism")!;
if (style !== "all" && !(style in strokeStylePresets)) throw new Error("Unknown style");
const seed = option("--seed", "lab-v1")!;
if (!seed.trim()) throw new Error("A non-empty seed is required");
const tolerance = Number(option("--tolerance", "0.01"));
if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) throw new Error("Tolerance must be between 0 and 1");
const colours = ["#c74232", "#285fa6", "#e4b942", "#397b51", "#72539e", "#d7824a", "#2b2a29", "#ece3ce"];
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(name: string, paintAt: (x: number, y: number) => number): Fixture {
  const widthPx = 120, heightPx = 90;
  const pixels = Uint8Array.from({ length: widthPx * heightPx }, (_, i) => paintAt(i % widthPx, Math.floor(i / widthPx)));
  return { name, canvas: { widthMm: 240, heightMm: 180 }, map: { widthPx, heightPx, paintIds: colours.map((_, i) => `paint-${i}`), pixels,
    luminance: Float32Array.from(pixels, p => p === 255 ? 1 : [.35, .3, .75, .4, .3, .55, .12, .9][p]) } };
}
let fixtures = [
  fixture("solid", () => 0),
  fixture("eight-colours", (x, y) => Math.floor(x / 30) + 4 * Math.floor(y / 45)),
  fixture("diagonal", (x, y) => x > y * 1.3 ? 0 : 1),
  fixture("rings", (x, y) => Math.floor(Math.hypot(x - 60, y - 45) / 9) % 3),
  fixture("thin-details", (x, y) => x % 20 < 2 || y % 22 < 2 ? 0 : 1),
  fixture("masked-islands", (x, y) => Math.hypot(x - 30, y - 45) < 20 ? 0 : Math.hypot(x - 90, y - 45) < 20 ? 1 : 255),
];
const input = option("--input");
if (input) {
  const data = JSON.parse(await readFile(resolve(input), "utf8"));
  if (!data.map || !Array.isArray(data.map.pixels) || data.map.pixels.some((v: unknown) => !Number.isInteger(v) || Number(v) < 0 || Number(v) > 255)) throw new Error("Input requires map.pixels as byte values");
  if (data.map.luminance && (!Array.isArray(data.map.luminance) || data.map.luminance.length !== data.map.pixels.length || data.map.luminance.some((v: unknown) => typeof v !== "number" || !Number.isFinite(v)))) throw new Error("Invalid luminance");
  fixtures = [{ ...data, name: String(data.name ?? "custom"), map: { ...data.map, pixels: Uint8Array.from(data.map.pixels), luminance: data.map.luminance ? Float32Array.from(data.map.luminance) : undefined } }];
}
await mkdir(out, { recursive: true });
// A fixed wet-on-wet visual probe makes colour transport visible independently
// of whichever trajectory algorithm is currently being evaluated.
const demoWidth = 320, demoHeight = 180, demoPixels = new Uint8ClampedArray(demoWidth * 2 * demoHeight * 4);
for (const [side, pickup] of [0, .7].entries()) {
  const demo = new PaintRaster(demoWidth, demoHeight, { widthMm: 80, heightMm: 45 }, { name: "Mixing probe", shape: "round", widthMm: 10 },
    [{ id: "blue", hex: "#002185" }, { id: "yellow", hex: "#FCD300" }], { ...paintSimulationDefaults, opacity: 1, wetMix: .8, pickup, dragLengthMm: 45, bristle: .12 });
  for (let pass = 0; pass < 4; pass++) demo.stroke({ x: 30, y: 2 }, { x: 30, y: 43 }, "blue", 1, 1, 1, pass, pass + 1);
  demo.load("yellow"); demo.stroke({ x: 2, y: 22 }, { x: 78, y: 22 }, "yellow", 1, 1, 1, 4, 5);
  for (let y = 0; y < demoHeight; y++) demoPixels.set(demo.rgba.subarray(y * demoWidth * 4, (y + 1) * demoWidth * 4), (y * demoWidth * 2 + side * demoWidth) * 4);
}
await writeFile(join(out, "mixing-demo.png"), encodePng(demoWidth * 2, demoHeight, demoPixels));
const baselinePath = option("--baseline");
const baseline = baselinePath ? JSON.parse(await readFile(resolve(baselinePath), "utf8")) : undefined;
if (baseline && (baseline.schemaVersion !== 2 || baseline.oracleVersion !== "geometric-v1+mixbox-v2" || !Array.isArray(baseline.results))) throw new Error("Incompatible baseline: regenerate with the current simulator");
const failures: string[] = [];
const results = [];
const cards: string[] = [];
function geometricSvg(map: ColorRegionMap, pixels: Uint8Array, error = false, displayColours = colours) {
  const rows: string[] = [];
  for (let y = 0; y < map.heightPx; y++) for (let x = 0; x < map.widthPx;) {
    const at = y * map.widthPx + x;
    const colourAt = (i: number) => !error ? pixels[i] === 255 ? "#eee8da" : displayColours[pixels[i] % displayColours.length] :
      pixels[i] === map.pixels[i] ? "#397b51" : map.pixels[i] === 255 ? "#b64ac2" : pixels[i] === 255 ? "#f1c548" : "#dc493c";
    const colour = colourAt(at); let end = x + 1;
    while (end < map.widthPx && colourAt(y * map.widthPx + end) === colour) end++;
    rows.push(`<path d="M${x} ${y + .5}h${end - x}" stroke="${colour}"/>`); x = end;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${map.widthPx} ${map.heightPx}" shape-rendering="crispEdges">${rows.join("")}</svg>`;
}
const styles = style === "all" ? Object.keys(strokeStylePresets) : [style];
const templateOption = option("--template");
if (templateOption && templateOption !== "all" && !strokeTemplates.some(t => t.id === templateOption)) throw new Error("Unknown template");
const runs = templateOption ? strokeTemplates.filter(t => templateOption === "all" || t.id === templateOption) : styles.map(id => ({ id, ...strokeStylePresets[id as keyof typeof strokeStylePresets] }));
for (const item of fixtures) for (const preset of runs) {
  const styleName = preset.id;
  const brush = item.brush ?? preset.brush;
  const settings = { ...preset.settings, ...item.settings, seed };
  // Validate map/dimensions before calling the generator.
  evaluateTrajectories({ formatVersion: 1, projectId: "validation", operations: [] }, item.map, item.canvas, brush);
  const workspace = syncWorkspace(defaultWorkspace(item.canvas), item.canvas, item.map.paintIds.map(id => ({ id, name: id, skipPainting: false })));
  const started = performance.now();
  const palette = item.palette ?? item.map.paintIds.map((id, i) => ({ id, hex: colours[i % colours.length] }));
  const generate = () => item.plan ?? generateStyledStrokes(item.name, { ...item.map, palette }, item.canvas, brush, settings);
  const rawPlan = generate();
  const deterministic = hash(rawPlan) === hash(generate());
  const initial = evaluateTrajectories(rawPlan, item.map, item.canvas, brush);
  // Malformed plans must never reach the simulator, which assumes valid geometry.
  const plan = initial.issues.length ? rawPlan : optimizeStrokeOrder(rawPlan, workspace);
  const generationMs = performance.now() - started;
  const evaluation = evaluateTrajectories(plan, item.map, item.canvas, brush);
  const simulation = evaluation.issues.length ? undefined : buildSimulation(plan, workspace, settings.paintLoadLengthMm ?? 120, brush.widthMm);
  const key = `${item.name}/${styleName}`;
  if (!Array.isArray(palette) || new Set(palette.map(p => p.id)).size !== palette.length) throw new Error("Palette paint IDs must be unique");
  if (item.map.paintIds.some(id => !palette.some(p => p.id === id))) throw new Error("Palette must define every map paint ID");
  const fingerprint = hash({ map: item.map, canvas: item.canvas, brush, settings, palette, suppliedPlan: item.plan });
  const issues = [...evaluation.issues, ...(simulation?.issues ?? [])];
  if (!deterministic) issues.push("Generator is not deterministic for a fixed seed");
  if (evaluation.metrics.zeroLengthStrokes) issues.push("Zero-length strokes");
  if (evaluation.metrics.targetPixels && !evaluation.metrics.strokes) issues.push("Non-empty target produced no strokes");
  const paintWidth = item.map.widthPx * 2, paintHeight = item.map.heightPx * 2;
  const origin = workspace.zones.find(z => z.type === "canvas")!;
  const raster = renderPaintTimeline(simulation ?? { events: [], duration: 0, paintDistance: 0, travelDistance: 0, strokes: 0, loads: 0, cleans: 0, issues: [] },
    item.canvas, brush, palette, paintWidth, paintHeight, settings.paintSimulation ?? paintSimulationDefaults, "#eee8da", origin);
  const difference = new Uint8ClampedArray(raster.rgba.length), targetRgb = palette.map(p => rgbFromHex(p.hex));
  let squaredError = 0, evaluatedPixels = 0;
  for (let y = 0; y < paintHeight; y++) for (let x = 0; x < paintWidth; x++) {
    const i = y * paintWidth + x, target = item.map.pixels[Math.floor(y / 2) * item.map.widthPx + Math.floor(x / 2)];
    const rgb = target === 255 ? [238, 232, 218] : targetRgb[palette.findIndex(p => p.id === item.map.paintIds[target])];
    let error = 0;
    for (let c = 0; c < 3; c++) error += ((raster.rgba[i * 4 + c] - rgb[c]) / 255) ** 2;
    if (target !== 255) { squaredError += error; evaluatedPixels++; }
    const intensity = Math.min(255, Math.round(Math.sqrt(error / 3) * 510));
    difference.set([intensity, Math.max(0, 120 - intensity), 30, 255], i * 4);
  }
  const metrics = { ...evaluation.metrics, simulatedRgbRmse: evaluatedPixels ? Math.sqrt(squaredError / (evaluatedPixels * 3)) : 0,
    durationSeconds: simulation?.duration ?? 0, serviceTravelMm: simulation?.travelDistance ?? 0, loads: simulation?.loads ?? 0, cleans: simulation?.cleans ?? 0 };
  const deltas: Record<string, number> = {};
  if (baseline) {
    const before = baseline.results.find((r: { key: string }) => r.key === key);
    if (!before || before.fingerprint !== fingerprint) issues.push("Missing baseline case or changed input/settings");
    else for (const metric of ["accuracy", "missing", "wrong", "spill", "simulatedRgbRmse"] as const) {
      if (!Number.isFinite(before.metrics?.[metric]) || before.metrics[metric] < 0 || before.metrics[metric] > 1) throw new Error(`Invalid baseline metric ${metric}`);
      deltas[metric] = metrics[metric] - before.metrics[metric];
      if ((metric === "accuracy" ? -deltas[metric] : deltas[metric]) > tolerance) issues.push(`Regression in ${metric}: ${deltas[metric].toFixed(4)}`);
    }
  }
  failures.push(...issues.map(issue => `${key}: ${issue}`));
  const prefix = `${results.length}-${styleName}`;
  await writeFile(join(out, `${prefix}-wet-paint.png`), encodePng(paintWidth, paintHeight, raster.rgba));
  await writeFile(join(out, `${prefix}-colour-error.png`), encodePng(paintWidth, paintHeight, difference));
  const displayColours = item.map.paintIds.map(id => palette.find(p => p.id === id)!.hex);
  const target = geometricSvg(item.map, item.map.pixels, false, displayColours), painting = geometricSvg(item.map, evaluation.painted, false, displayColours), errors = geometricSvg(item.map, evaluation.painted, true);
  const paths = plan.operations.flatMap(op => op.type !== "stroke" || op.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ? [] : [`<polyline points="${op.points.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${colours[Math.max(0, item.map.paintIds.indexOf(op.paintId)) % colours.length]}" stroke-width=".7"/>`]);
  const trajectory = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${item.canvas.widthMm} ${item.canvas.heightMm}"><rect width="100%" height="100%" fill="#eee8da"/>${paths.join("")}</svg>`;
  for (const [name, svg] of Object.entries({ target, painting, errors, trajectory })) await writeFile(join(out, `${prefix}-${name}.svg`), svg);
  await writeFile(join(out, `${prefix}-plan.json`), JSON.stringify(plan));
  results.push({ key, fingerprint, planHash: hash(plan), deterministic, generationMs, metrics, deltas, issues, settings, brush });
  console.log(`${key}: accuracy ${(metrics.accuracy * 100).toFixed(1)}%, missing ${(metrics.missing * 100).toFixed(1)}%, wrong ${(metrics.wrong * 100).toFixed(1)}%, ${metrics.strokes} strokes${issues.length ? " FAIL" : ""}`);
  cards.push(`<section><h2>${escape(key)}</h2><p>Správná barva ${(metrics.accuracy * 100).toFixed(1)} % · chybí ${(metrics.missing * 100).toFixed(1)} % · špatná barva ${(metrics.wrong * 100).toFixed(1)} % · zásah masky ${(metrics.spill * 100).toFixed(1)} % · ${metrics.strokes} tahů · ${(metrics.durationSeconds / 60).toFixed(1)} min · barevná RMSE ${metrics.simulatedRgbRmse.toFixed(3)}</p><div class="images">${["target", "trajectory", "painting", "errors"].map((name, i) => `<figure><img src="${prefix}-${name}.svg"><figcaption>${["Cílový obraz", "Trajektorie", "Geometrická malba", "Mapa chyb"][i]}</figcaption></figure>`).join("")}<figure><img src="${prefix}-wet-paint.png"><figcaption>Pixelová malba · Mixbox</figcaption></figure><figure><img src="${prefix}-colour-error.png"><figcaption>Odchylka barev · červená = větší</figcaption></figure></div><p>${issues.map(escape).join("<br>")}</p><details><summary>Metriky a porovnání</summary><pre>${escape(JSON.stringify({ metrics, deltas }, null, 2))}</pre></details></section>`);
}
// A full-suite comparison may not silently drop baseline cases.
if (baseline && !input && (style === "all" || templateOption === "all")) for (const before of baseline.results) if (!results.some(r => r.key === before.key)) failures.push(`Baseline case disappeared: ${before.key}`);
await writeFile(join(out, "report.json"), JSON.stringify({ schemaVersion: 2, oracleVersion: "geometric-v1+mixbox-v2", seed, results, failures }, null, 2));
await writeFile(join(out, "index.html"), `<!doctype html><html lang="cs"><meta charset="utf-8"><title>Caravaiggio – trajectory lab</title><style>body{font:15px system-ui;background:#171b21;color:#eee;margin:30px}section{padding:20px;background:#242a32;margin:20px 0;border-radius:12px}.images{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}img{width:100%;background:#eee8da}pre{white-space:pre-wrap}figcaption{padding:8px}h1{font-size:28px}@media(max-width:900px){.images{grid-template-columns:repeat(2,1fr)}}</style><h1>Kontrola trajektorií a malby</h1><p>Seed: ${escape(seed)} · ${failures.length ? `${failures.length} problémů` : "Kontroly prošly"}. Mapa chyb: zelená správně, žlutá nepokryto, červená špatná barva, fialová zásah masky.</p><p>Geometrický otisk v pořadí tahů, plná kryvost. Kulatý štětec: disk; plochý: pevný čtverec. Pixelový PNG náhled navíc používá Mixbox, tlak, kryvost, úbytek náplně, nabírání podkladové barvy, její tažení a časové schnutí. Nízké skóre samo o sobě není chyba testu; regrese se posuzuje proti baseline.</p><figure><img style="max-width:640px" src="mixing-demo.png"><figcaption>Kontrolní překřížení: vlevo pigmentový blending bez nabírání, vpravo s nabíráním a tažením podkladové barvy doprava.</figcaption></figure>${cards.join("")}<footer>Mixbox © 2022 Secret Weapons · <a href="https://github.com/scrtwpns/mixbox">CC BY-NC 4.0</a></footer></html>`);
console.log(`Report: ${join(out, "index.html")}`);
if (failures.length) process.exitCode = 1;
