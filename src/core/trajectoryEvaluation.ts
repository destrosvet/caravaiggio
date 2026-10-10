import type { PaintingPlan, Point } from "./model.ts";
import type { BrushProfile, ColorRegionMap } from "./strokes.ts";
import { maxPaletteColors } from "./paletteLimits.ts";

/** Independent geometric oracle: round brush discs, flat brush square stamps.
 * Rasterize the actual polyline in plan order, without clipping to target colours.
 * This deliberately does not reuse the generator's internal coverage algorithm.
 */
export function evaluateTrajectories(plan: PaintingPlan, map: ColorRegionMap,
  canvas: { widthMm: number; heightMm: number }, brush: BrushProfile) {
  if (!Number.isInteger(map.widthPx) || !Number.isInteger(map.heightPx) || map.widthPx < 1 || map.heightPx < 1 ||
      map.pixels.length !== map.widthPx * map.heightPx || map.paintIds.length > maxPaletteColors ||
      map.paintIds.some(id => typeof id !== "string" || !id.trim()) ||
      new Set(map.paintIds).size !== map.paintIds.length ||
      [...map.pixels].some(value => value !== 255 && value >= map.paintIds.length)) throw new Error("Invalid evaluation map.");
  if (![canvas.widthMm, canvas.heightMm, brush.widthMm].every(value => Number.isFinite(value) && value > 0) ||
      !["round", "flat"].includes(brush.shape)) throw new Error("Invalid evaluation dimensions or brush shape.");
  const painted = new Uint8Array(map.pixels.length).fill(255);
  const hits = new Uint32Array(map.pixels.length);
  const issues: string[] = [];
  const lengths: number[] = [];
  let travelMm = 0, previous: Point | undefined, colourChanges = 0, lastPaint: string | undefined;
  let outsideStrokes = 0, invalidStrokes = 0;
  const dx = canvas.widthMm / map.widthPx, dy = canvas.heightMm / map.heightPx;
  const radius = brush.widthMm / 2;
  const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  for (const [operationIndex, stroke] of plan.operations.entries()) {
    if (stroke.type !== "stroke") { issues.push(`Operation ${operationIndex}: evaluation requires a stroke-only plan.`); continue; }
    const paint = map.paintIds.indexOf(stroke.paintId);
    if (paint < 0 || stroke.points.length < 2 || stroke.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
        !Number.isFinite(stroke.pressure) || stroke.pressure < 0 || stroke.pressure > 1 ||
        !Number.isFinite(stroke.speedMmPerMin) || stroke.speedMmPerMin <= 0) {
      invalidStrokes++; issues.push(`Stroke ${operationIndex}: invalid geometry, paint, pressure or speed.`); continue;
    }
    if (stroke.points.some(p => p.x < 0 || p.y < 0 || p.x > canvas.widthMm || p.y > canvas.heightMm)) outsideStrokes++;
    if (previous) travelMm += distance(previous, stroke.points[0]);
    previous = stroke.points.at(-1)!;
    if (lastPaint !== undefined && lastPaint !== stroke.paintId) colourChanges++;
    lastPaint = stroke.paintId;
    let length = 0;
    const touched = new Set<number>();
    for (let segment = 1; segment < stroke.points.length; segment++) {
      const a = stroke.points[segment - 1], b = stroke.points[segment];
      const segmentLength = distance(a, b); length += segmentLength;
      // Analytical distance to a segment for round brushes; axis-aligned square
      // footprint swept over a segment for flat brushes (not a bristle model).
      const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius) / dx));
      const maxX = Math.min(map.widthPx - 1, Math.floor((Math.max(a.x, b.x) + radius) / dx));
      const minY = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius) / dy));
      const maxY = Math.min(map.heightPx - 1, Math.floor((Math.max(a.y, b.y) + radius) / dy));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = (x + .5) * dx, py = (y + .5) * dy;
        let inside: boolean;
        if (brush.shape === "round") {
          const t = segmentLength ? Math.max(0, Math.min(1, ((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) / segmentLength ** 2)) : 0;
          inside = Math.hypot(px - a.x - t * (b.x - a.x), py - a.y - t * (b.y - a.y)) <= radius;
        } else {
          let low = 0, high = 1;
          for (const [start, delta, center] of [[a.x, b.x - a.x, px], [a.y, b.y - a.y, py]]) {
            if (Math.abs(delta) < 1e-12) { if (Math.abs(start - center) > radius) high = -1; }
            else { const u = (center - radius - start) / delta, v = (center + radius - start) / delta; low = Math.max(low, Math.min(u, v)); high = Math.min(high, Math.max(u, v)); }
          }
          inside = low <= high;
        }
        if (inside) touched.add(y * map.widthPx + x);
      }
    }
    lengths.push(length);
    for (const pixel of touched) { painted[pixel] = paint; hits[pixel]++; }
  }
  if (outsideStrokes) issues.push(`${outsideStrokes} stroke centre lines leave the canvas.`);
  let targetPixels = 0, correctPixels = 0, missingPixels = 0, wrongPixels = 0, spillPixels = 0, overlapPixels = 0;
  const perPaint = map.paintIds.map(paintId => ({ paintId, targetPixels: 0, correctPixels: 0 }));
  for (let i = 0; i < painted.length; i++) {
    if (hits[i] > 1) overlapPixels++;
    const target = map.pixels[i];
    if (target === 255) { if (painted[i] !== 255) spillPixels++; continue; }
    targetPixels++; perPaint[target].targetPixels++;
    if (painted[i] === target) { correctPixels++; perPaint[target].correctPixels++; }
    else if (painted[i] === 255) missingPixels++;
    else wrongPixels++;
  }
  const ratio = (n: number, d: number) => d ? n / d : 0;
  return { painted, hits, issues, metrics: {
    strokes: lengths.length, invalidStrokes, outsideStrokes, zeroLengthStrokes: lengths.filter(n => n < 1e-9).length,
    paintMm: lengths.reduce((a, b) => a + b, 0), travelMm, colourChanges,
    minLengthMm: lengths.length ? lengths.reduce((a, b) => Math.min(a, b), Infinity) : 0, maxLengthMm: lengths.reduce((a, b) => Math.max(a, b), 0),
    targetPixels, correctPixels, missingPixels, wrongPixels, spillPixels,
    coverage: ratio(targetPixels - missingPixels, targetPixels), accuracy: ratio(correctPixels, targetPixels),
    missing: ratio(missingPixels, targetPixels), wrong: ratio(wrongPixels, targetPixels),
    spill: ratio(spillPixels, painted.length), overlap: ratio(overlapPixels, painted.length),
    perPaint: perPaint.map(p => ({ ...p, accuracy: ratio(p.correctPixels, p.targetPixels) })),
  } };
}
