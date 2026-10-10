import mixbox from "mixbox";
import type { BrushProfile } from "./strokes.ts";
import type { Point } from "./model.ts";
import type { SimulationTimeline } from "./simulation.ts";

export type PaintSimulationSettings = Readonly<{ opacity: number; wetMix: number; pickup: number; dragLengthMm: number; dryingSeconds: number; bristle: number }>;
export const paintSimulationDefaults: PaintSimulationSettings = { opacity: .8, wetMix: .65, pickup: .18, dragLengthMm: 18, dryingSeconds: 180, bristle: .25 };
export const paintPreviewLongestEdge = 640;
export const paintSimulationParameters = [
  { key: "opacity", label: "Paint opacity", min: .1, max: 1, step: .05 },
  { key: "wetMix", label: "Wet pigment blending", min: 0, max: 1, step: .05 },
  { key: "pickup", label: "Pick up underlying paint", min: 0, max: .8, step: .02 },
  { key: "dragLengthMm", label: "Carry colour distance · mm", min: 1, max: 100, step: 1 },
  { key: "dryingSeconds", label: "Drying time · seconds", min: 10, max: 1800, step: 10 },
  { key: "bristle", label: "Bristle texture", min: 0, max: .9, step: .05 },
] as const;
export function validatePaintSimulation(value: unknown): PaintSimulationSettings {
  if (value === undefined) return { ...paintSimulationDefaults };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid paint simulation settings.");
  const object = value as Record<string, unknown>;
  for (const key of Object.keys(object)) if (!paintSimulationParameters.some(p => p.key === key)) throw new Error(`Unknown paint simulation parameter ${key}.`);
  return Object.fromEntries(paintSimulationParameters.map(p => {
    const n = object[p.key] ?? paintSimulationDefaults[p.key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < p.min || n > p.max) throw new Error(`Invalid paint simulation parameter ${p.key}.`);
    return [p.key, n];
  })) as PaintSimulationSettings;
}
export const rgbFromHex = (hex: string) => {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error("Expected a six-digit RGB colour.");
  return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16));
};

/** Deterministic wet-paint approximation, shared by preview, playback and lab.
 * Pigment mixing is Mixbox; wetness, pickup and brush transport are our model.
 */
export class PaintRaster {
  rgba: Uint8ClampedArray;
  coverage: Float32Array;
  private latent: Float32Array;
  private deposited: Float32Array;
  private palette: Map<string, number[]>;
  private reservoir: number[] = [];
  private currentPaint = "";
  private contact: { end: Point; time: number; distance: number; tx: number; ty: number } | null = null;
  private background: number[];
  private size = mixbox.LATENT_SIZE;
  readonly width: number;
  readonly height: number;
  readonly canvas: { widthMm: number; heightMm: number };
  readonly brush: BrushProfile;
  readonly settings: PaintSimulationSettings;
  constructor(width: number, height: number,
    canvas: { widthMm: number; heightMm: number }, brush: BrushProfile,
    palette: readonly { id: string; hex: string }[], settings = paintSimulationDefaults, paper = "#eee8da") {
    this.width = width; this.height = height; this.canvas = canvas; this.brush = brush; this.settings = settings;
    if (![width, height].every(n => Number.isInteger(n) && n > 0) || ![canvas.widthMm, canvas.heightMm, brush.widthMm].every(n => Number.isFinite(n) && n > 0)) throw new Error("Invalid paint raster dimensions.");
    validatePaintSimulation(settings);
    this.rgba = new Uint8ClampedArray(width * height * 4);
    this.coverage = new Float32Array(width * height);
    this.latent = new Float32Array(width * height * this.size);
    this.deposited = new Float32Array(width * height);
    this.background = rgbFromHex(paper);
    this.palette = new Map(palette.map(p => [p.id, mixbox.rgbToLatent(rgbFromHex(p.hex))]));
    for (let i = 0; i < width * height; i++) { this.rgba.set(this.background, i * 4); this.rgba[i * 4 + 3] = 255; }
  }
  load(paintId: string) { const pigment = this.palette.get(paintId); if (!pigment) throw new Error(`Unknown paint ${paintId}`); this.currentPaint = paintId; this.reservoir = [...pigment]; this.contact = null; }
  clean() { this.currentPaint = ""; this.reservoir = []; this.contact = null; }
  clone() {
    const copy = Object.assign(Object.create(PaintRaster.prototype) as PaintRaster, this);
    copy.rgba = this.rgba.slice(); copy.coverage = this.coverage.slice();
    copy.latent = this.latent.slice(); copy.deposited = this.deposited.slice(); copy.reservoir = [...this.reservoir];
    return copy;
  }
  stroke(from: Point, to: Point, paintId: string, pressure: number, loadStart: number, loadEnd: number, startSeconds: number, endSeconds: number) {
    if (![from.x, from.y, to.x, to.y, pressure, loadStart, loadEnd, startSeconds, endSeconds].every(Number.isFinite) || pressure < 0 || pressure > 1) throw new Error("Invalid raster stroke.");
    if (paintId !== this.currentPaint) this.load(paintId);
    const fresh = this.palette.get(paintId)!;
    const dx = this.canvas.widthMm / this.width, dy = this.canvas.heightMm / this.height;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length || pressure === 0) return;
    const spacing = Math.min(dx, dy, this.brush.widthMm / 3) * .65;
    const stamps = Math.max(1, Math.ceil(length / spacing)), ds = length / stamps;
    const radius = this.brush.widthMm / 2 * (.65 + .35 * pressure);
    const targetX = (to.x - from.x) / length, targetY = (to.y - from.y) / length;
    const previous = this.contact;
    const continuous = previous && Math.hypot(previous.end.x - from.x, previous.end.y - from.y) < 1e-6 && Math.abs(previous.time - startSeconds) < 1e-6;
    let tx = continuous ? previous.tx : targetX, ty = continuous ? previous.ty : targetY;
    const startDistance = continuous ? previous.distance : 0;
    // Resolve fibres in brush coordinates, avoiding screen-aligned banding.
    const fibres = Math.max(2, Math.min(10, radius / Math.max(dx, dy) * .55));
    const dirtyPixels = new Set<number>();
    for (let stamp = 0; stamp < stamps; stamp++) {
      const t = (stamp + .5) / stamps, x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
      const time = startSeconds + (endSeconds - startSeconds) * t;
      const load = Math.max(0, Math.min(1, loadStart + (loadEnd - loadStart) * t));
      const turn = 1 - Math.exp(-ds / Math.max(.1, radius * .4));
      tx += (targetX - tx) * turn; ty += (targetY - ty) * turn;
      const tangentLength = Math.hypot(tx, ty) || 1;
      const ux = tx / tangentLength, uy = ty / tangentLength;
      const travelled = startDistance + length * t;
      const picked = new Array<number>(this.size).fill(0); let pickupWeight = 0;
      const recovery = 1 - Math.exp(-ds / this.settings.dragLengthMm);
      for (let c = 0; c < this.size; c++) this.reservoir[c] += (fresh[c] - this.reservoir[c]) * recovery;
      const bounds = radius * (this.brush.shape === "flat" ? 1.12 : 1);
      for (let py = Math.max(0, Math.floor((y - bounds) / dy)); py <= Math.min(this.height - 1, Math.floor((y + bounds) / dy)); py++)
        for (let px = Math.max(0, Math.floor((x - bounds) / dx)); px <= Math.min(this.width - 1, Math.floor((x + bounds) / dx)); px++) {
          const ox = (px + .5) * dx - x, oy = (py + .5) * dy - y;
          const cross = -ox * uy + oy * ux, along = ox * ux + oy * uy;
          const distance = this.brush.shape === "round" ? Math.hypot(ox, oy) : Math.max(Math.abs(cross), Math.abs(along) * 2);
          if (distance > radius) continue;
          const i = py * this.width + px, offset = i * this.size, oldAlpha = this.coverage[i];
          const wet = oldAlpha * Math.exp(-Math.max(0, time - this.deposited[i]) / this.settings.dryingSeconds);
          const across = cross / radius;
          const phase = across * fibres * Math.PI + .65 * Math.sin(across * 4.7) + .3 * Math.sin(across * 9.1 + .3)
            + .2 * Math.sin(travelled / Math.max(1, radius * 2) + across * 3);
          const grooves = (.5 + .5 * Math.sin(phase)) ** 3;
          const texture = Math.max(.03, 1 - this.settings.bristle * (.2 + .8 * grooves) * 1.8);
          const edge = Math.min(1, Math.max(0, (radius - distance) / Math.max(dx, dy) + .2));
          const amount = this.settings.opacity * pressure * (.15 + .85 * load) * texture * edge;
          const depth = this.brush.shape === "flat" ? radius * .25 : radius * .5;
          const alpha = 1 - Math.exp(-amount * ds / Math.max(.01, depth));
          if (alpha <= 0) continue;
          // Wet layers contribute their existing pigment volume to the mix;
          // dry layers are overpainted faster. Paper is optical coverage,
          // not white pigment in the Mixbox reservoir.
          const mix = oldAlpha ? alpha / (1 + wet * this.settings.wetMix * 4) : 1;
          for (let c = 0; c < this.size; c++) {
            picked[c] += this.latent[offset + c] * wet * alpha;
            this.latent[offset + c] = oldAlpha ? this.latent[offset + c] * (1 - mix) + this.reservoir[c] * mix : this.reservoir[c];
          }
          pickupWeight += wet * alpha;
          this.coverage[i] = oldAlpha + (1 - oldAlpha) * alpha;
          this.deposited[i] = time;
          dirtyPixels.add(i);
        }
      if (pickupWeight) {
        const pickup = 1 - Math.exp(-this.settings.pickup * ds / Math.max(.1, radius));
        for (let c = 0; c < this.size; c++) this.reservoir[c] = this.reservoir[c] * (1 - pickup) + picked[c] / pickupWeight * pickup;
      }
    }
    this.contact = { end: { ...to }, time: endSeconds, distance: startDistance + length, tx, ty };
    // Convert each changed pigment pixel once per segment, rather than once
    // for every overlapping brush stamp. Transport uses the latent layer.
    for (const i of dirtyPixels) {
      const rgb = mixbox.latentToRgb(Array.from(this.latent.subarray(i * this.size, (i + 1) * this.size)));
      for (let c = 0; c < 3; c++) this.rgba[i * 4 + c] = rgb[c] * this.coverage[i] + this.background[c] * (1 - this.coverage[i]);
    }
  }
}
export function renderPaintTimeline(timeline: SimulationTimeline, canvas: { widthMm: number; heightMm: number },
  brush: BrushProfile, palette: readonly { id: string; hex: string }[], width: number, height: number,
  settings = paintSimulationDefaults, paper = "#eee8da", origin: Point = { x: 0, y: 0 }, until = Infinity) {
  const raster = new PaintRaster(width, height, canvas, brush, palette, settings, paper);
  for (const event of timeline.events) {
    if (event.start >= until) break;
    if (event.type === "load" && event.paintId) raster.load(event.paintId);
    if (event.type === "clean") raster.clean();
    if (event.type !== "stroke" || !event.paintId) continue;
    const fraction = event.end > event.start ? Math.min(1, (until - event.start) / (event.end - event.start)) : 1;
    raster.stroke({ x: event.from.x - origin.x, y: event.from.y - origin.y },
      { x: event.from.x + (event.to.x - event.from.x) * fraction - origin.x, y: event.from.y + (event.to.y - event.from.y) * fraction - origin.y },
      event.paintId, event.pressure ?? .5, event.loadStart, event.loadStart + (event.loadEnd - event.loadStart) * fraction, event.start, Math.min(until, event.end));
  }
  return raster;
}
