import type { PaintingPlan, Point, Stroke } from "./model.ts";
import type { BrushProfile, ColorRegionMap, StrokeGenerationSettings } from "./strokes.ts";

/** Repaint recognized facial features last, without relying on a style's seed lattice. */
export function addRecognitionStrokes(plan: PaintingPlan, map: ColorRegionMap,
  canvas: { widthMm: number; heightMm: number }, brush: BrushProfile, settings: StrokeGenerationSettings): PaintingPlan {
  if (!map.recognitionMap) return plan;
  const w = map.widthPx, h = map.heightPx, recognition = map.recognitionMap;
  if (recognition.length !== w * h) throw Error("Invalid recognition map.");
  if (!settings.pressure) return plan;
  const dx = canvas.widthMm / w, dy = canvas.heightMm / h;
  const visited = new Uint8Array(w * h), covered = new Uint8Array(w * h);
  const strokes: Stroke[] = [];
  let components = 0, pixels = 0;
  const eligible = (i: number, paint: number) => recognition[i] > 0 && map.pixels[i] === paint;
  const at = (q: Point) => {
    const x = Math.floor(q.x / dx), y = Math.floor(q.y / dy);
    return x >= 0 && y >= 0 && x < w && y < h ? y * w + x : -1;
  };
  for (let first = 0; first < w * h; first++) {
    const paint = map.pixels[first];
    if (visited[first] || !recognition[first] || !map.paintIds[paint]) continue;
    const queue = [first]; visited[first] = 1;
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % w, y = Math.floor(i / w);
      const px = (x + .5) * dx, py = (y + .5) * dy;
      sx += px; sy += py; sxx += px * px; syy += py * py; sxy += px * py;
      for (const next of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, y > 0 ? i - w : -1, y + 1 < h ? i + w : -1]) {
        if (next >= 0 && !visited[next] && eligible(next, paint)) { visited[next] = 1; queue.push(next); }
      }
    }
    components++; pixels += queue.length;
    const cx = sx / queue.length, cy = sy / queue.length;
    const angle = .5 * Math.atan2(2 * (sxy / queue.length - cx * cy), sxx / queue.length - cx * cx - syy / queue.length + cy * cy);
    // Every colour component gets a seed, including an isolated pupil or a thin mouth.
    const centre = queue.reduce((best, i) => {
      const distance = (index: number) => ((index % w + .5) * dx - cx) ** 2 + ((Math.floor(index / w) + .5) * dy - cy) ** 2;
      return distance(i) < distance(best) ? i : best;
    }, first);
    for (const seed of [centre, ...queue.filter(i => i !== centre)]) {
      if (seed !== centre && covered[seed]) continue;
      const origin = { x: (seed % w + .5) * dx, y: (Math.floor(seed / w) + .5) * dy };
      const step = Math.min(dx, dy) * .25;
      const maximum = Math.min(settings.maxStrokeLengthMm ?? 75, Math.max(step, brush.widthMm * 2));
      const trace = (sign: number) => {
        const points: Point[] = [];
        for (let length = step; length <= maximum / 2; length += step) {
          const q = { x: origin.x + Math.cos(angle) * length * sign, y: origin.y + Math.sin(angle) * length * sign };
          const i = at(q); if (i < 0 || !eligible(i, paint)) break;
          points.push(q);
        }
        return points;
      };
      const points = [...trace(-1).reverse(), origin, ...trace(1)];
      if (points.length < 2) {
        // A physical touch still needs a finite G1 segment inside the source pixel.
        points.push({ x: origin.x + Math.min(step, maximum) * .5, y: origin.y });
      }
      let length = 0;
      for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x-points[i-1].x, points[i].y-points[i-1].y);
      strokes.push({ type: "stroke", phase: "recognition", paintId: map.paintIds[paint], points: points as [Point, Point, ...Point[]],
        pressure: settings.pressure, speedMmPerMin: settings.speedMmPerMin, expectedLoadStart: 1,
        expectedLoadEnd: Math.max(0, 1 - length / (settings.paintLoadLengthMm ?? 120)) });
      const radius = Math.max(step, brush.widthMm * .4), rx = radius / dx, ry = radius / dy;
      for (const q of points) {
        const px = q.x / dx, py = q.y / dy;
        for (let y = Math.max(0, Math.floor(py-ry)); y < Math.min(h, Math.ceil(py+ry)); y++) {
          for (let x = Math.max(0, Math.floor(px-rx)); x < Math.min(w, Math.ceil(px+rx)); x++) {
            const i = y*w+x;
            if (eligible(i, paint) && ((x+.5-px)/rx)**2+((y+.5-py)/ry)**2 <= 1) covered[i] = 1;
          }
        }
      }
    }
  }
  return { ...plan, operations: [...plan.operations, ...strokes], recognitionStats: { strokes: strokes.length, components, pixels } };
}
