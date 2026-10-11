import type { PaintingPlan, Point, Stroke } from "./model.ts";
import type { ColorRegionMap } from "./strokes.ts";
import { segmentIntersectsZone } from "./simulation.ts";
/** Conservative square footprint, including for round brushes. No unpainted pixels or different colours may be bridged. */
export function joinMachineStrokes(plan: PaintingPlan, map: ColorRegionMap, canvas: { widthMm: number; heightMm: number }, brushWidth: number, maxGap: number) {
  const operations: Stroke[] = [];
  let joins = 0, addedDistance = 0;
  const valid = Number.isInteger(map.widthPx) && Number.isInteger(map.heightPx) && map.widthPx > 0 && map.heightPx > 0 && map.pixels.length === map.widthPx * map.heightPx && canvas.widthMm > 0 && canvas.heightMm > 0;
  if (!valid || plan.operations.some(op => op.type !== "stroke")) return { plan, joins, addedDistance };
  const dx = canvas.widthMm / map.widthPx, dy = canvas.heightMm / map.heightPx, radius = brushWidth / 2;
  const bridgeFits = (a: Point, b: Point, paintId: string) => {
    if (Math.min(a.x,b.x)-radius < 0 || Math.min(a.y,b.y)-radius < 0 || Math.max(a.x,b.x)+radius > canvas.widthMm || Math.max(a.y,b.y)+radius > canvas.heightMm) return false;
    const paint = map.paintIds.indexOf(paintId);
    if (paint < 0) return false;
    const x0 = Math.floor((Math.min(a.x,b.x)-radius)/dx), x1 = Math.ceil((Math.max(a.x,b.x)+radius)/dx)-1;
    const y0 = Math.floor((Math.min(a.y,b.y)-radius)/dy), y1 = Math.ceil((Math.max(a.y,b.y)+radius)/dy)-1;
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
      if (map.pixels[y*map.widthPx+x] === paint) continue;
      if (segmentIntersectsZone(a,b,{id:"pixel",type:"forbidden",name:"pixel",x:x*dx,y:y*dy,width:dx,height:dy},radius)) return false;
    }
    return true;
  };
  for (const next of plan.operations as readonly Stroke[]) {
    const previous = operations.at(-1);
    if (previous && previous.paintId === next.paintId && previous.phase === next.phase && previous.phase !== "shadows" && previous.phase !== "recognition" && previous.speedMmPerMin === next.speedMmPerMin && previous.pressure === next.pressure) {
      const end = previous.points.at(-1)!, start = next.points[0], gap = Math.hypot(end.x-start.x,end.y-start.y);
      if (gap <= maxGap && (gap === 0 || bridgeFits(end,start,previous.paintId))) {
        operations[operations.length-1] = { ...previous, points: [...previous.points, ...next.points.slice(gap === 0 ? 1 : 0)] as Stroke["points"], expectedLoadEnd: next.expectedLoadEnd };
        joins++; addedDistance += gap; continue;
      }
    }
    operations.push(next);
  }
  return { plan: { ...plan, operations }, joins, addedDistance };
}
