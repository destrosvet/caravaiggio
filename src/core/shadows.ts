import { hexToRgb, rgbToOklab, perceptualPaintDistance, isPaintEligible } from "./color.ts";
import type { PaintingPlan, Point, Stroke } from "./model.ts";
import type { BrushProfile, ColorRegionMap, StrokeGenerationSettings } from "./strokes.ts";

export type ShadowSettings = Readonly<{ enabled: boolean; strength: number; detail: number; lengthMm: number; density: number; paintId: string }>;
export type ShadowPaint = Readonly<{ id: string; hex: string; skipPainting?: boolean; restricted?: boolean; hueToleranceDeg?: number; minimumChroma?: number }>;
export const shadowDefaults: ShadowSettings = { enabled: false, strength: .5, detail: .45, lengthMm: 12, density: .55, paintId: "auto" };
export const shadowParameters = [
  { key: "strength", label: "Shadow strength", min: 0, max: 1, step: .05 },
  { key: "detail", label: "Detail sensitivity", min: 0, max: 1, step: .05 },
  { key: "lengthMm", label: "Shadow stroke length · mm", min: 2, max: 80, step: 1 },
  { key: "density", label: "Shadow stroke density", min: .1, max: 1, step: .05 },
] as const;
export function validateShadows(value: unknown): ShadowSettings {
  if (value === undefined) return { ...shadowDefaults };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shadow settings.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["enabled", "paintId", ...shadowParameters.map(p => p.key)].includes(key))) throw new Error("Unknown shadow parameter.");
  if (typeof v.enabled !== "boolean" || typeof v.paintId !== "string" || !v.paintId.trim()) throw new Error("Invalid shadow mode or colour.");
  for (const p of shadowParameters) if (typeof v[p.key] !== "number" || !Number.isFinite(v[p.key]) || (v[p.key] as number) < p.min || (v[p.key] as number) > p.max) throw new Error(`Invalid shadow ${p.key}.`);
  return { enabled: v.enabled, paintId: v.paintId, ...Object.fromEntries(shadowParameters.map(p => [p.key, v[p.key]])) } as ShadowSettings;
}
const luminance = (hex: string) => { const rgb = hexToRgb(hex); return (.2126 * rgb.r + .7152 * rgb.g + .0722 * rgb.b) / 255; };

/** Source-driven tonal detail after the base pass; never crosses a colour mask. */
export function addShadowStrokes(plan: PaintingPlan, map: ColorRegionMap, canvas: { widthMm: number; heightMm: number }, brush: BrushProfile, settings: StrokeGenerationSettings): PaintingPlan {
  const config = validateShadows(settings.shadows);
  if (!config.enabled || !config.strength || !settings.pressure) return plan;
  const w = map.widthPx, h = map.heightPx, source = map.luminance, palette = map.palette;
  if (!source || source.length !== w * h || !palette) throw new Error("Shadow detail requires the source image and paint palette.");
  if (map.sourceRgba && map.sourceRgba.length !== w * h * 4) throw new Error("Invalid source pixels for shadows.");
  if (Array.from(source).some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error("Invalid source luminance for shadows.");
  const paints = palette.map(p => ({ ...p, light: luminance(p.hex), lab: rgbToOklab(hexToRgb(p.hex)) }));
  const bases = map.paintIds.map(id => paints.find(p => p.id === id));
  const dx = canvas.widthMm / w, dy = canvas.heightMm / h;
  const threshold = .025 + (1 - config.detail) * .09;
  const radiusMm = Math.max(Math.min(dx, dy), brush.widthMm * (.12 + (1 - config.detail) * .25));
  const rx = Math.max(1, Math.ceil(radiusMm / dx)), ry = Math.max(1, Math.ceil(radiusMm / dy));
  const smooth = new Float32Array(w * h), residual = new Float32Array(w * h);
  let eligiblePixels = 0, noDarkerPaintSeeds = 0;
  // A region-aware box blur suppresses fabric noise without leaking across masks.
  const horizontal = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let left = 0;
    while (left < w) {
      const paint = map.pixels[y * w + left]; let right = left + 1;
      while (right < w && map.pixels[y * w + right] === paint) right++;
      const sums = new Float64Array(right - left + 1);
      for (let x = left; x < right; x++) sums[x - left + 1] = sums[x - left] + source[y * w + x];
      for (let x = left; x < right; x++) { const a = Math.max(left, x - rx), b = Math.min(right, x + rx + 1); horizontal[y * w + x] = (sums[b - left] - sums[a - left]) / (b - a); }
      left = right;
    }
  }
  for (let x = 0; x < w; x++) {
    let top = 0;
    while (top < h) {
      const paint = map.pixels[top * w + x]; let bottom = top + 1;
      while (bottom < h && map.pixels[bottom * w + x] === paint) bottom++;
      const sums = new Float64Array(bottom - top + 1);
      for (let y = top; y < bottom; y++) sums[y - top + 1] = sums[y - top] + horizontal[y * w + x];
      for (let y = top; y < bottom; y++) { const a = Math.max(top, y - ry), b = Math.min(bottom, y + ry + 1), i = y * w + x;
        smooth[i] = (sums[b - top] - sums[a - top]) / (b - a);
        if (bases[paint] && !bases[paint]!.skipPainting) residual[i] = Math.max(0, bases[paint]!.light - smooth[i] - threshold);
        if (residual[i] > 0) eligiblePixels++;
      }
      top = bottom;
    }
  }
  const at = (q: Point) => { const x = Math.floor(q.x / dx), y = Math.floor(q.y / dy); return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1; };
  const occupied = new Uint8Array(w * h);
  const axes = new Map<string, { x: number; y: number }>();
  for (const op of plan.operations) if (op.type === "stroke" && !op.phase) {
    const a = op.points[0], b = op.points.at(-1)!, angle = Math.atan2(b.y - a.y, b.x - a.x), length = Math.hypot(b.x - a.x, b.y - a.y);
    const sum = axes.get(op.paintId) ?? { x: 0, y: 0 }; sum.x += Math.cos(angle * 2) * length; sum.y += Math.sin(angle * 2) * length; axes.set(op.paintId, sum);
  }
  let hash = 2166136261;
  for (const c of settings.seed) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const random = (i: number) => { let n = Math.imul(i ^ hash, 2246822519); n = Math.imul(n ^ n >>> 13, 3266489917); return ((n ^ n >>> 16) >>> 0) / 4294967296; };
  const spacing = brush.widthMm * (1.4 - config.density * 1.05);
  const seeds: { point: Point; i: number }[] = [];
  for (let y = spacing / 2, row = 0; y < canvas.heightMm; y += spacing, row++) for (let x = spacing / 2 + row % 2 * spacing / 2; x < canvas.widthMm; x += spacing) {
    const point = { x, y }, i = at(point); if (i >= 0 && residual[i] > 0) seeds.push({ point, i });
  }
  seeds.sort((a, b) => residual[b.i] - residual[a.i] || a.i - b.i);
  const shadows: Stroke[] = [];
  for (const seed of seeds) {
    if (occupied[seed.i]) continue;
    const baseIndex = map.pixels[seed.i], base = bases[baseIndex]; if (!base) continue;
    const seedLab = map.sourceRgba ? rgbToOklab({ r: map.sourceRgba[seed.i * 4], g: map.sourceRgba[seed.i * 4 + 1], b: map.sourceRgba[seed.i * 4 + 2] }) : base.lab;
    const candidates = paints.filter(p => !p.skipPainting && p.light < base.light - .035 && (config.paintId === "auto" || p.id === config.paintId) && isPaintEligible(seedLab, p.lab, p));
    const deepEnough = candidates.filter(p => p.light <= smooth[seed.i] + .03);
    const pigment = (deepEnough.length ? deepEnough : candidates).sort((a, b) => {
      const score = (p: typeof base) => perceptualPaintDistance(base.lab, p.lab) + Math.abs(p.light - smooth[seed.i]) * .3;
      return score(a) - score(b);
    })[0];
    if (!pigment) { noDarkerPaintSeeds++; continue; }
    const footprint = brush.widthMm * .5 * (brush.shape === "flat" ? 1.12 : 1);
    const valid = (q: Point) => {
      const i = at(q); if (i < 0 || map.pixels[i] !== baseIndex || residual[i] <= 0 || source[i] >= base.light - threshold * .5) return false;
      // Restricted paints keep the palette's hue/chroma protection. Missing RGB
      // falls back to the base colour, rather than admitting an unrelated accent.
      const sourceLab = map.sourceRgba ? rgbToOklab({ r: map.sourceRgba[i * 4], g: map.sourceRgba[i * 4 + 1], b: map.sourceRgba[i * 4 + 2] }) : base.lab;
      if (!isPaintEligible(sourceLab, pigment.lab, pigment)) return false;
      if (q.x < footprint || q.y < footprint || q.x + footprint >= canvas.widthMm || q.y + footprint >= canvas.heightMm) return false;
      const pixelMargin = Math.hypot(dx, dy) / 2;
      for (let py = Math.max(0, Math.floor((q.y - footprint) / dy)); py <= Math.min(h - 1, Math.floor((q.y + footprint) / dy)); py++)
        for (let px = Math.max(0, Math.floor((q.x - footprint) / dx)); px <= Math.min(w - 1, Math.floor((q.x + footprint) / dx)); px++)
          if (Math.hypot((px + .5) * dx - q.x, (py + .5) * dy - q.y) <= footprint + pixelMargin && map.pixels[py * w + px] !== baseIndex) return false;
      return true;
    };
    if (!valid(seed.point)) continue;
    const xi = seed.i % w, yi = Math.floor(seed.i / w), sample = (x: number, y: number) => smooth[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
    const gx = (sample(xi + 1, yi) - sample(xi - 1, yi)) / dx, gy = (sample(xi, yi + 1) - sample(xi, yi - 1)) / dy;
    const axis = axes.get(base.id), fallback = axis ? Math.atan2(axis.y, axis.x) / 2 : 0;
    const angle = (Math.hypot(gx, gy) > .005 ? Math.atan2(gx, -gy) : fallback) + (random(seed.i) - .5) * .2;
    const step = Math.min(dx, dy, brush.widthMm / 3) * .7;
    const trace = (sign: number) => { const points: Point[] = []; let q = seed.point;
      for (let length = step; length <= config.lengthMm / 2; length += step) { const next = { x: q.x + Math.cos(angle) * step * sign, y: q.y + Math.sin(angle) * step * sign }; if (!valid(next)) break; points.push(next); q = next; }
      return points;
    };
    const points = [...trace(-1).reverse(), seed.point, ...trace(1)], length = (points.length - 1) * step;
    if (length < Math.min(config.lengthMm * .4, Math.max(1, brush.widthMm * .3))) continue;
    const needed = Math.min(.8, (base.light - smooth[seed.i]) / (base.light - pigment.light));
    const pressure = Math.min(settings.pressure, .65, Math.max(.03, config.strength * Math.sqrt(needed) * (.6 + settings.pressure * .4)));
    shadows.push({ type: "stroke", phase: "shadows", points: points as unknown as Stroke["points"], paintId: pigment.id, pressure,
      speedMmPerMin: settings.speedMmPerMin * .8, expectedLoadStart: 1, expectedLoadEnd: Math.max(0, 1 - length / (settings.paintLoadLengthMm ?? 120)) });
    for (const q of points) for (let py = Math.max(0, Math.floor((q.y - spacing / 2) / dy)); py < Math.min(h, Math.ceil((q.y + spacing / 2) / dy)); py++)
      for (let px = Math.max(0, Math.floor((q.x - spacing / 2) / dx)); px < Math.min(w, Math.ceil((q.x + spacing / 2) / dx)); px++) occupied[py * w + px] = 1;
  }
  // If the final base pigment also shades something, start with that pigment
  // while it is still on the brush. All base layers have already been painted.
  const lastPaint = [...plan.operations].reverse().find(op => op.type === "stroke");
  if (lastPaint?.type === "stroke") shadows.sort((a, b) => Number(b.paintId === lastPaint.paintId) - Number(a.paintId === lastPaint.paintId));
  return { ...plan, operations: [...plan.operations, ...shadows], shadowStats: { strokes: shadows.length, eligiblePixels, noDarkerPaintSeeds } };
}
