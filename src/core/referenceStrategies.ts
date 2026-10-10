import type { PaintingPlan, Point, Stroke } from "./model.ts";
import type { BrushProfile, ColorRegionMap, StrokeGenerationSettings } from "./strokes.ts";
import { strategyParameters } from "./strategySchema.ts";
import { detailPriorityMap, validatePriority } from "./priority.ts";

export function generateReferenceStrokes(projectId: string, map: ColorRegionMap,
  canvas: { widthMm: number; heightMm: number }, brush: BrushProfile, settings: StrokeGenerationSettings): PaintingPlan {
  const w = map.widthPx, h = map.heightPx;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || map.pixels.length !== w * h ||
    ![canvas.widthMm, canvas.heightMm, brush.widthMm, settings.speedMmPerMin].every(n => Number.isFinite(n) && n > 0) ||
    !Number.isFinite(settings.overlap) || settings.overlap < 0 || settings.overlap >= 1) throw new Error("Invalid trajectory input.");
  const strategy = settings.strategy ?? "legacy", p = strategyParameters(strategy, settings.strategyParameters);
  const dx = canvas.widthMm / w, dy = canvas.heightMm / h, step = Math.min(dx, dy, brush.widthMm / 3) * .5;
  const min = settings.minStrokeLengthMm ?? 1, max = settings.maxStrokeLengthMm ?? 75;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min || !Number.isFinite(settings.pressure) || settings.pressure < 0 || settings.pressure > 1) throw new Error("Invalid stroke limits.");
  let state = 2166136261;
  for (const c of settings.seed.trim() || `${Date.now()}:${Math.random()}`) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  state ||= 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const paintAt = (point: Point) => {
    const x = Math.floor(point.x / dx), y = Math.floor(point.y / dy);
    return x >= 0 && y >= 0 && x < w && y < h ? map.pixels[y * w + x] : 255;
  };
  const operations: Stroke[] = [];
  let omittedShortStrokes = 0;
  const emit = (source: readonly Point[], minimum = min) => {
    let points: Point[] = [], length = 0, paint = 255;
    const flush = () => {
      const count = Math.max(1, Math.ceil((length - 1e-9) / max));
      if (points.length > 1 && length + 1e-6 >= minimum) {
        // Distribute the remainder across chunks instead of dropping a short tail.
        // With unusually tight min/max limits a fully covering split may be
        // impossible. Keep valid maximum-length chunks in that case.
        const target = length / count + 1e-6 >= minimum ? length / count : max;
        let chunk: Point[] = [points[0]], chunkLength = 0;
        const push = () => {
          operations.push({ type: "stroke", points: chunk as unknown as Stroke["points"],
            paintId: map.paintIds[paint], pressure: settings.pressure, speedMmPerMin: settings.speedMmPerMin,
            expectedLoadStart: 1, expectedLoadEnd: Math.max(0, 1 - chunkLength / (settings.paintLoadLengthMm ?? 120)) });
        };
        for (let i = 1; i < points.length; i++) {
          let from = points[i - 1]; const to = points[i];
          let remaining = Math.hypot(to.x - from.x, to.y - from.y);
          while (chunkLength + remaining >= target - 1e-9 && remaining > 1e-9) {
            const fraction = Math.min(1, (target - chunkLength) / remaining);
            const end = { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
            chunk.push(end); chunkLength += remaining * fraction; push();
            chunk = [end]; chunkLength = 0; from = end;
            remaining = Math.hypot(to.x - from.x, to.y - from.y);
          }
          if (remaining > 1e-9) { chunk.push(to); chunkLength += remaining; }
        }
        if (chunkLength + 1e-6 >= minimum) push();
        else if (chunkLength > 1e-6) omittedShortStrokes++;
      } else if (points.length > 1) omittedShortStrokes++;
      points = []; length = 0;
    };
    const sample = (q: Point) => {
      const next = paintAt(q);
      if (!map.paintIds[next]) { flush(); paint = 255; return; }
      if (next !== paint) { flush(); paint = next; }
      if (points.length) {
        const from = points.at(-1)!;
        length += Math.hypot(q.x - from.x, q.y - from.y);
      }
      points.push(q);
    };
    if (source.length) sample(source[0]);
    for (let i = 1; i < source.length; i++) {
      const a = source[i - 1], b = source[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let j = 1; j <= n; j++) sample({ x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n });
    }
    flush();
  };
  if (strategy === "dabs") {
    const spacing = brush.widthMm * p.spacing, half = brush.widthMm * p.length / 2;
    for (let row = 0, y = spacing / 2; y < canvas.heightMm; y += spacing, row++) for (let x = spacing / 2 + row % 2 * spacing / 2; x < canvas.widthMm; x += spacing) {
      const center = { x: x + (random() - .5) * spacing * p.jitter, y: y + (random() - .5) * spacing * p.jitter };
      const angle = (p.angle + (random() - .5) * p.angleVariation) * Math.PI / 180;
      emit([{ x: center.x - Math.cos(angle) * half, y: center.y - Math.sin(angle) * half }, { x: center.x + Math.cos(angle) * half, y: center.y + Math.sin(angle) * half }]);
    }
  } else if (strategy === "decorative-lines") {
    const angle = p.angle * Math.PI / 180, extent = Math.hypot(canvas.widthMm, canvas.heightMm);
    const variationPhase = random() * Math.PI * 2;
    for (let offset = -extent; offset <= extent; offset += p.spacingMm) {
      const points: Point[] = [];
      for (let along = -extent; along <= extent; along += step) {
        const phase = along / p.wavelengthMm * Math.PI * 2 + variationPhase;
        const across = offset + Math.sin(phase + offset * .035) * p.amplitudeMm;
        const curl = p.curl * p.amplitudeMm * Math.cos(phase * 2 + offset * .08);
        points.push({ x: canvas.widthMm / 2 + Math.cos(angle) * (along + curl) - Math.sin(angle) * across,
          y: canvas.heightMm / 2 + Math.sin(angle) * (along + curl) + Math.cos(angle) * across });
      }
      emit(points);
    }
  } else if (strategy === "flow-curves") {
    const priority = validatePriority(settings.priority);
    const simplify = priority.enabled && priority.simplifyBackground;
    const importance = map.priorityMap ?? detailPriorityMap(map, canvas, brush, priority);
    if (importance.length !== w * h) throw new Error("Invalid priority map.");
    const priorityAt = (q: Point) => importance[Math.max(0, Math.min(h - 1, Math.floor(q.y / dy))) * w + Math.max(0, Math.min(w - 1, Math.floor(q.x / dx)))];
    const field = new Float32Array(w * h), base = p.angle * Math.PI / 180;
    const variationPhase = random() * Math.PI * 2;
    const luminance = map.luminance ?? Float32Array.from(map.pixels, v => v === 255 ? 1 : v / Math.max(1, map.paintIds.length - 1));
    if (luminance.length !== w * h) throw new Error("Invalid luminance dimensions.");
    const at = (x: number, y: number) => luminance[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
    const xx = new Float64Array((w + 1) * (h + 1)), yy = new Float64Array(xx.length), xy = new Float64Array(xx.length), stride = w + 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = (at(x + 1, y) - at(x - 1, y)) / dx, gy = (at(x, y + 1) - at(x, y - 1)) / dy, i = (y + 1) * stride + x + 1;
      for (const [array, value] of [[xx, gx * gx], [yy, gy * gy], [xy, gx * gy]] as const) array[i] = value + array[i - 1] + array[i - stride] - array[i - stride - 1];
    }
    const box = (array: Float64Array, x: number, y: number) => {
      const x0 = Math.max(0, x - p.fieldRadius), x1 = Math.min(w, x + p.fieldRadius + 1), y0 = Math.max(0, y - p.fieldRadius), y1 = Math.min(h, y + p.fieldRadius + 1);
      return array[y1 * stride + x1] - array[y0 * stride + x1] - array[y1 * stride + x0] + array[y0 * stride + x0];
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = box(xx, x, y), b = box(yy, x, y), c = box(xy, x, y);
      const coherence = Math.hypot(a - b, 2 * c) / (a + b + 1e-12), tangent = .5 * Math.atan2(2 * c, a - b) + Math.PI / 2;
      const confidence = simplify ? Math.min(1, (a + b) / Math.max(1, (2 * p.fieldRadius + 1) ** 2) / .0001) : 1;
      const quiet = simplify ? 1 - priority.calm * (1 - importance[y * w + x]) : 1;
      const mix = p.imageInfluence * coherence * confidence * quiet;
      field[y * w + x] = .5 * Math.atan2(Math.sin(2 * base) * (1 - mix) + Math.sin(2 * tangent) * mix, Math.cos(2 * base) * (1 - mix) + Math.cos(2 * tangent) * mix);
    }
    const covered = new Uint8Array(w * h), detailCovered = new Uint8Array(w * h), spacing = brush.widthMm * (1 - settings.overlap);
    const angleAt = (q: Point) => {
      const x = Math.max(0, Math.min(w - 1, Math.floor(q.x / dx))), y = Math.max(0, Math.min(h - 1, Math.floor(q.y / dy)));
      const weight = importance[y * w + x];
      const bend = simplify ? 1 - priority.calm * (1 - weight) : 1;
      return field[y * w + x] + p.bend * bend * .6 * Math.sin((q.x + q.y * .6) / p.wavelengthMm * Math.PI * 2 + variationPhase);
    };
    const seedSpacing = Math.max(Math.min(dx, dy) * .5, spacing / (1 + (priority.enabled ? priority.strength * 1.5 : 0)));
    // Generate the unchanged base layer first. Priority adds local detail;
    // it must not move the seed lattice or replace the existing composition.
    const seeds: (Point & { extra: boolean })[] = [];
    const baseSpacing = Math.max(Math.min(dx, dy) * .5, spacing);
    for (let y = baseSpacing / 2; y < canvas.heightMm; y += baseSpacing) for (let x = baseSpacing / 2; x < canvas.widthMm; x += baseSpacing) seeds.push({ x, y, extra: false });
    if (priority.enabled) {
      const details: (Point & { extra: boolean })[] = [];
      for (let y = seedSpacing / 2; y < canvas.heightMm; y += seedSpacing) for (let x = seedSpacing / 2; x < canvas.widthMm; x += seedSpacing) if (priorityAt({ x, y }) > .05) details.push({ x, y, extra: true });
      details.sort((a, b) => priorityAt(b) - priorityAt(a) || a.y - b.y || a.x - b.x);
      seeds.push(...details);
    }
    for (const start of seeds) {
      const { x, y } = start, paint = paintAt(start), index = Math.floor(y / dy) * w + Math.floor(x / dx);
      if (!map.paintIds[paint] || (start.extra ? detailCovered[index] : covered[index])) continue;
      const trace = (sign: number) => {
        const anchor = { x, y }, points = [anchor]; let q = anchor, angle = angleAt(start) + (sign < 0 ? Math.PI : 0);
        for (let length = step; length <= max / 2; length += step) {
          let turn = Math.atan2(Math.sin(angleAt(q) - angle), Math.cos(angleAt(q) - angle));
          if (turn > Math.PI / 2) turn -= Math.PI; if (turn < -Math.PI / 2) turn += Math.PI;
          angle += Math.max(-p.turnLimit * step, Math.min(p.turnLimit * step, turn));
          const next = { x: q.x + Math.cos(angle) * step, y: q.y + Math.sin(angle) * step };
          if (paintAt(next) !== paint) break;
          if (start.extra && priorityAt(next) <= .05) break;
          points.push(next); q = next;
        }
        return points;
      };
      const path = [...trace(-1).reverse(), ...trace(1).slice(1)], before = operations.length;
      const weight = priorityAt(start);
      const minimum = start.extra ? min + (Math.min(min, priority.detailMinMm) - min) * weight : min;
      emit(path, minimum);
      // Reserve only footprints of accepted strokes; avoid repeatedly tracing the same area.
      for (const stroke of operations.slice(before)) for (const q of stroke.points) {
        // Reserve centre-line spacing, not the full brush footprint. Reserving
        // brush width cancelled the user's overlap, even at overlap 0.7.
        for (const [coverage, localSpacing] of [[covered, spacing], [detailCovered, spacing / (1 + (priority.enabled ? priority.strength * priorityAt(q) * 1.5 : 0))]] as const) {
        const reserve = Math.max(Math.min(dx, dy) * .3, localSpacing * .48);
        const rx = reserve / dx, ry = reserve / dy, cx = q.x / dx, cy = q.y / dy;
        for (let iy = Math.max(0, Math.floor(cy - ry)); iy < Math.min(h, Math.ceil(cy + ry)); iy++) for (let ix = Math.max(0, Math.floor(cx - rx)); ix < Math.min(w, Math.ceil(cx + rx)); ix++)
          if (((ix + .5 - cx) / rx) ** 2 + ((iy + .5 - cy) / ry) ** 2 <= 1) coverage[iy * w + ix] = 1;
        }
      }
    }
  } else if (strategy === "curved-offsets") {
    // Physical chamfer distance to material boundaries, then marching squares of
    // inward offsets. Separate fields prevent paths joining unrelated colours.
    for (let paint = 0; paint < map.paintIds.length; paint++) {
      const distance = new Float32Array(w * h).fill(1e6);
      const same = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && map.pixels[y * w + x] === paint;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!same(x, y)) distance[i] = 0;
        else if (!same(x - 1, y) || !same(x + 1, y) || !same(x, y - 1) || !same(x, y + 1)) distance[i] = Math.min(dx, dy) / 2;
      }
      for (const reverse of [false, true]) for (let ay = 0; ay < h; ay++) for (let ax = 0; ax < w; ax++) {
        const x = reverse ? w - 1 - ax : ax, y = reverse ? h - 1 - ay : ay, i = y * w + x, sign = reverse ? 1 : -1;
        if (!same(x, y)) continue;
        for (const [ox, oy, cost] of [[sign, 0, dx], [0, sign, dy], [sign, sign, Math.hypot(dx, dy)], [-sign, sign, Math.hypot(dx, dy)]])
          if (same(x + ox, y + oy)) distance[i] = Math.min(distance[i], distance[(y + oy) * w + x + ox] + cost);
      }
      const largest = distance.reduce((a, b, i) => map.pixels[i] === paint ? Math.max(a, b) : a, 0);
      for (let level = brush.widthMm * p.inset; level < largest; level += brush.widthMm * p.spacing) {
        const segments: [Point, Point][] = [];
        for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
          const corners = [{ x: (x + .5) * dx, y: (y + .5) * dy }, { x: (x + 1.5) * dx, y: (y + .5) * dy }, { x: (x + 1.5) * dx, y: (y + 1.5) * dy }, { x: (x + .5) * dx, y: (y + 1.5) * dy }];
          const values = [distance[y * w + x], distance[y * w + x + 1], distance[(y + 1) * w + x + 1], distance[(y + 1) * w + x]];
          const crossings: Point[] = [];
          for (let edge = 0; edge < 4; edge++) {
            const next = (edge + 1) % 4;
            if ((values[edge] >= level) === (values[next] >= level)) continue;
            const t = (level - values[edge]) / (values[next] - values[edge]);
            crossings.push({ x: corners[edge].x + t * (corners[next].x - corners[edge].x), y: corners[edge].y + t * (corners[next].y - corners[edge].y) });
          }
          for (let i = 0; i + 1 < crossings.length; i += 2) segments.push([crossings[i], crossings[i + 1]]);
        }
        const key = (q: Point) => `${q.x.toFixed(5)},${q.y.toFixed(5)}`, endpoints = new Map<string, number[]>(), seen = new Set<number>();
        segments.forEach((segment, i) => segment.forEach(q => { const k = key(q); endpoints.set(k, [...(endpoints.get(k) ?? []), i]); }));
        for (let i = 0; i < segments.length; i++) {
          if (seen.has(i)) continue;
          seen.add(i); let path: Point[] = [...segments[i]];
          for (const reverse of [false, true]) {
            if (reverse) path.reverse();
            while (true) {
              const end = path.at(-1)!, next = endpoints.get(key(end))?.find(j => !seen.has(j));
              if (next === undefined) break;
              seen.add(next); const pair = segments[next]; path.push(key(pair[0]) === key(end) ? pair[1] : pair[0]);
            }
          }
          for (let pass = 0; pass < p.smoothing; pass++) path = path.map((q, j) => j === 0 || j === path.length - 1 ? q : { x: (path[j - 1].x + 2 * q.x + path[j + 1].x) / 4, y: (path[j - 1].y + 2 * q.y + path[j + 1].y) / 4 });
          emit(path);
        }
      }
    }
  }
  return { formatVersion: 1, projectId, operations, generationStats: { omittedShortStrokes, minLengthMm: min, maxLengthMm: max } };
}
