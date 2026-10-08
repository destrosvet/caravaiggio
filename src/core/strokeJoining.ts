import type { Stroke } from "./model.ts";
import type { ColorRegionMap } from "./strokes.ts";
const length = (points: Stroke["points"]) => points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
/** Join nearby endpoints only when the connecting brush footprint stays in the same material. */
export function joinNearbyStrokes(strokes: readonly Stroke[], map: ColorRegionMap, canvas: Readonly<{ widthMm: number; heightMm: number }>, brushWidth: number, maxLength: number): Stroke[] {
  const gap = Math.max(0.1, brushWidth * 0.75);
  const cells = new Map<string, { index: number; reverse: boolean }[]>();
  const key = (paint: string, x: number, y: number) => `${paint}:${x}:${y}`;
  strokes.forEach((stroke, index) => {
    for (const reverse of [false, true]) {
      const point = reverse ? stroke.points.at(-1)! : stroke.points[0];
      const cell = key(stroke.paintId, Math.floor(point.x / gap), Math.floor(point.y / gap));
      const list = cells.get(cell) ?? []; list.push({ index, reverse }); cells.set(cell, list);
    }
  });
  const used = new Uint8Array(strokes.length), lengths = strokes.map(stroke => length(stroke.points));
  const result: Stroke[] = [];
  const validBridge = (a: { x: number; y: number }, b: { x: number; y: number }, paintId: string) => {
    const paint = map.paintIds.indexOf(paintId), distance = Math.hypot(a.x - b.x, a.y - b.y);
    const step = Math.min(canvas.widthMm / map.widthPx, canvas.heightMm / map.heightPx) / 2;
    const count = Math.max(1, Math.ceil(distance / step));
    for (let index = 0; index <= count; index++) for (let angle = 0; angle < 9; angle++) {
      const radius = angle === 8 ? 0 : brushWidth / 2;
      const x = Math.floor((a.x + (b.x - a.x) * index / count + Math.cos(angle * Math.PI / 4) * radius) / canvas.widthMm * map.widthPx);
      const y = Math.floor((a.y + (b.y - a.y) * index / count + Math.sin(angle * Math.PI / 4) * radius) / canvas.heightMm * map.heightPx);
      if (x < 0 || y < 0 || x >= map.widthPx || y >= map.heightPx || map.pixels[y * map.widthPx + x] !== paint) return false;
    }
    return true;
  };
  strokes.forEach((initial, initialIndex) => {
    if (used[initialIndex]) return;
    used[initialIndex] = 1;
    let points = [...initial.points], total = lengths[initialIndex];
    while (total < maxLength) {
      const end = points.at(-1)!;
      const x = Math.floor(end.x / gap), y = Math.floor(end.y / gap);
      let best: { index: number; reverse: boolean; gap: number } | undefined;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const candidate of cells.get(key(initial.paintId, x + dx, y + dy)) ?? []) {
        if (used[candidate.index]) continue;
        const next = strokes[candidate.index];
        if (next.speedMmPerMin !== initial.speedMmPerMin || Math.abs(next.pressure - initial.pressure) > 0.05) continue;
        const start = candidate.reverse ? next.points.at(-1)! : next.points[0];
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        if (distance > gap || (best && distance >= best.gap) || total + distance + lengths[candidate.index] > maxLength + 1e-6) continue;
        if (validBridge(end, start, initial.paintId)) best = { ...candidate, gap: distance };
      }
      if (!best) break;
      const next = best.reverse ? [...strokes[best.index].points].reverse() : strokes[best.index].points;
      used[best.index] = 1; total += best.gap + lengths[best.index]; points.push(...next);
    }
    result.push({ ...initial, points: points as unknown as Stroke["points"] });
  });
  return result;
}
