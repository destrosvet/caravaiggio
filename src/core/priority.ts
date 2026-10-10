import type { ColorRegionMap, BrushProfile } from "./strokes.ts";
export type FocusMask = Readonly<{ width: number; height: number; values: readonly number[] }>;
export type PrioritySettings = Readonly<{ enabled: boolean; automatic: boolean; simplifyBackground: boolean; strength: number; scaleMm: number; calm: number; detailMinMm: number; focus: boolean; x: number; y: number; width: number; height: number; mask?: FocusMask }>;
export const priorityDefaults: PrioritySettings = { enabled: false, automatic: true, simplifyBackground: false, strength: .6, scaleMm: 8, calm: .8, detailMinMm: 2, focus: false, x: .5, y: .5, width: .5, height: .7 };
export const priorityParameters = [
  { key: "strength", label: "Extra detail density", min: 0, max: 1, step: .05 },
  { key: "scaleMm", label: "Detail scale · mm", min: 2, max: 30, step: 1 },
  { key: "calm", label: "Simplify quiet background", min: 0, max: 1, step: .05 },
  { key: "detailMinMm", label: "Minimum detail stroke · mm", min: 1, max: 20, step: .5 },
] as const;
export const focusParameters = [
  { key: "x", label: "Focus centre X", min: 0, max: 1, step: .01 },
  { key: "y", label: "Focus centre Y", min: 0, max: 1, step: .01 },
  { key: "width", label: "Focus width", min: .1, max: 1, step: .01 },
  { key: "height", label: "Focus height", min: .1, max: 1, step: .01 },
] as const;
export function validatePriority(value: unknown): PrioritySettings {
  if (value === undefined) return { ...priorityDefaults };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid detail priority settings.");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["enabled", "automatic", "simplifyBackground", "focus", "mask", ...priorityParameters.map(p => p.key), ...focusParameters.map(p => p.key)].includes(key))) throw new Error("Unknown detail priority parameter.");
  if (typeof v.enabled !== "boolean" || typeof v.focus !== "boolean") throw new Error("Invalid detail priority mode.");
  if (v.automatic !== undefined && typeof v.automatic !== "boolean") throw new Error("Invalid automatic detail priority mode.");
  if (v.simplifyBackground !== undefined && typeof v.simplifyBackground !== "boolean") throw new Error("Invalid background simplification mode.");
  for (const p of [...priorityParameters, ...focusParameters]) if (typeof v[p.key] !== "number" || !Number.isFinite(v[p.key]) || (v[p.key] as number) < p.min || (v[p.key] as number) > p.max) throw new Error(`Invalid detail priority ${p.key}.`);
  if (v.mask !== undefined) {
    const m = v.mask as FocusMask;
    if (!m || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1 || m.width > 256 || m.height > 256 || !Array.isArray(m.values) || m.values.length !== m.width * m.height || m.values.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error("Invalid painted focus mask.");
  }
  return { ...v, automatic: v.automatic ?? true, simplifyBackground: v.simplifyBackground ?? false } as PrioritySettings;
}
function blur(input: Float32Array, w: number, h: number, rx: number, ry: number) {
  const horizontal = new Float32Array(input.length), result = new Float32Array(input.length);
  for (let y = 0; y < h; y++) {
    const sums = new Float64Array(w + 1); for (let x = 0; x < w; x++) sums[x + 1] = sums[x] + input[y * w + x];
    for (let x = 0; x < w; x++) { const a = Math.max(0, x - rx), b = Math.min(w, x + rx + 1); horizontal[y * w + x] = (sums[b] - sums[a]) / (b - a); }
  }
  for (let x = 0; x < w; x++) {
    const sums = new Float64Array(h + 1); for (let y = 0; y < h; y++) sums[y + 1] = sums[y] + horizontal[y * w + x];
    for (let y = 0; y < h; y++) { const a = Math.max(0, y - ry), b = Math.min(h, y + ry + 1); result[y * w + x] = (sums[b] - sums[a]) / (b - a); }
  }
  return result;
}
/** Combine optional denoised photo details with the painted mask and legacy ellipse. */
export function detailPriorityMap(map: ColorRegionMap, canvas: { widthMm: number; heightMm: number }, brush: BrushProfile, config: PrioritySettings) {
  const w = map.widthPx, h = map.heightPx, result = new Float32Array(w * h);
  if (!config.enabled) return result;
  let energy = new Float32Array(result.length), normal = 1;
  if (config.automatic !== false) {
    if (!map.luminance || map.luminance.length !== result.length || Array.from(map.luminance).some(v => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error("Detail priority requires valid source luminance.");
    const dx = canvas.widthMm / w, dy = canvas.heightMm / h;
    const noiseMm = Math.max(.5, brush.widthMm * .1);
    const clean = blur(map.luminance, w, h, Math.max(1, Math.round(noiseMm / dx)), Math.max(1, Math.round(noiseMm / dy)));
    const low = blur(clean, w, h, Math.max(1, Math.round(config.scaleMm / dx)), Math.max(1, Math.round(config.scaleMm / dy)));
    const high = Float32Array.from(clean, (v, i) => map.pixels[i] === 255 ? 0 : Math.abs(v - low[i]));
    energy = blur(high, w, h, Math.max(1, Math.round(config.scaleMm * .3 / dx)), Math.max(1, Math.round(config.scaleMm * .3 / dy)));
    const sorted = Array.from(energy).filter((_, i) => map.pixels[i] !== 255).sort((a, b) => a - b);
    normal = Math.max(.025, sorted[Math.floor(sorted.length * .9)] ?? 0);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (map.pixels[i] === 255) continue;
    const automatic = Math.min(1, Math.max(0, (energy[i] - .008) / normal));
    const distance = (((x + .5) / w - config.x) / (config.width / 2)) ** 2 + (((y + .5) / h - config.y) / (config.height / 2)) ** 2;
    const focus = config.focus ? Math.sqrt(Math.max(0, 1 - distance)) : 0;
    result[i] = Math.max(automatic, focus, config.mask ? sampleFocusMask(config.mask, (x + .5) / w, (y + .5) / h) : 0);
  }
  return result;
}

export function sampleFocusMask(mask: FocusMask, x: number, y: number): number {
  const px = Math.max(0, Math.min(mask.width - 1, x * mask.width - .5));
  const py = Math.max(0, Math.min(mask.height - 1, y * mask.height - .5));
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const at = (a: number, b: number) => mask.values[Math.min(mask.height - 1, b) * mask.width + Math.min(mask.width - 1, a)] / 255;
  return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
}

/** Retain old ellipse selections when opening the painted editor. */
export function editableFocusMask(config: PrioritySettings, aspect: number): FocusMask {
  const width = aspect >= 1 ? 192 : Math.max(1, Math.round(192 * aspect));
  const height = aspect >= 1 ? Math.max(1, Math.round(192 / aspect)) : 192;
  const values = Array.from({ length: width * height }, (_, i) => {
    const x = (i % width + .5) / width, y = (Math.floor(i / width) + .5) / height;
    const ellipse = config.focus ? Math.sqrt(Math.max(0, 1 - ((x - config.x) / (config.width / 2)) ** 2 - ((y - config.y) / (config.height / 2)) ** 2)) : 0;
    return Math.round(Math.max(ellipse, config.mask ? sampleFocusMask(config.mask, x, y) : 0) * 255);
  });
  return { width, height, values };
}

/** Continuous soft brush capsule in image coordinates; radius is relative to the shorter side. */
export function paintFocusMask(mask: FocusMask, from: { x: number; y: number }, to: { x: number; y: number }, radius: number, erase: boolean): FocusMask {
  const w = mask.width, h = mask.height, r = radius * Math.min(w, h);
  const ax = from.x * w, ay = from.y * h, bx = to.x * w, by = to.y * h;
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
  const values = [...mask.values];
  for (let y = Math.max(0, Math.floor(Math.min(ay, by) - r)); y < Math.min(h, Math.ceil(Math.max(ay, by) + r)); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - r)); x < Math.min(w, Math.ceil(Math.max(ax, bx) + r)); x++) {
      const t = length2 ? Math.max(0, Math.min(1, ((x + .5 - ax) * dx + (y + .5 - ay) * dy) / length2)) : 0;
      const d = Math.hypot(x + .5 - ax - t * dx, y + .5 - ay - t * dy) / r;
      if (d >= 1) continue;
      const soft = 1 - d * d * (3 - 2 * d);
      const i = y * w + x;
      values[i] = Math.round(erase ? Math.min(values[i], 255 * (1 - soft)) : Math.max(values[i], 255 * soft));
    }
  }
  return { width: w, height: h, values };
}
