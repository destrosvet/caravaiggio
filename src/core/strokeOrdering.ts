import type { PaintingPlan, Point, Stroke } from "./model.ts";
import type { Workspace } from "./workspace.ts";
type Node = { stroke: Stroke; point: Point; axis: number; alive: boolean; count: number; left?: Node; right?: Node; parent?: Node };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function tree(strokes: Stroke[], depth = 0, parent?: Node): Node | undefined {
  if (!strokes.length) return;
  const axis = depth % 2, key = axis === 0 ? "x" : "y";
  const sorted = [...strokes].sort((a, b) => a.points[0][key] - b.points[0][key]);
  const middle = sorted.length >> 1, stroke = sorted[middle];
  const node: Node = { stroke, point: stroke.points[0], axis, alive: true, count: strokes.length, parent };
  node.left = tree(sorted.slice(0, middle), depth + 1, node); node.right = tree(sorted.slice(middle + 1), depth + 1, node);
  return node;
}
function nearest(root: Node, point: Point): Node {
  let best: Node | undefined, score = Infinity;
  const visit = (node?: Node) => {
    if (!node?.count) return;
    const delta = node.axis === 0 ? point.x - node.point.x : point.y - node.point.y;
    if (node.alive) { const next = distance(point, node.point); if (next < score) { score = next; best = node; } }
    visit(delta <= 0 ? node.left : node.right);
    if (Math.abs(delta) <= score) visit(delta <= 0 ? node.right : node.left);
  };
  visit(root); return best!;
}
function routeLength(strokes: readonly Stroke[], start: Point, end: Point): number {
  let position = start, length = 0;
  for (const stroke of strokes) { length += distance(position, stroke.points[0]); position = stroke.points.at(-1)!; }
  return length + distance(position, end);
}
/** Bounded directed Or-opt relocation: improve greedy dead ends without reversing strokes. */
function refineRoute(input: readonly Stroke[], start: Point, end: Point): Stroke[] {
  const route = [...input];
  for (let pass=0;pass<2;pass++) {
    let improved=false;
    for (let i=0;i<route.length;i++) {
      const stroke=route[i],before=i?route[i-1].points.at(-1)!:start,after=i+1<route.length?route[i+1].points[0]:end;
      const removal=distance(before,after)-distance(before,stroke.points[0])-distance(stroke.points.at(-1)!,after);
      let best=-2,bestDelta=-1e-6;
      for(let j=Math.max(-1,i-16);j<Math.min(route.length,i+17);j++) {
        if(j===i||j===i-1) continue;
        const from=j<0?start:route[j].points.at(-1)!,to=j+1<route.length?route[j+1].points[0]:end;
        const delta=removal+distance(from,stroke.points[0])+distance(stroke.points.at(-1)!,to)-distance(from,to);
        if(delta<bestDelta){bestDelta=delta;best=j;}
      }
      if(best!==-2){route.splice(i,1);route.splice((best>i?best-1:best)+1,0,stroke);improved=true;}
    }
    if(!improved) break;
  }
  return route;
}
/** Group paints, then shorten travel without reversing or changing stroke geometry. */
export function optimizeStrokeOrder(plan: PaintingPlan, workspace: Workspace): PaintingPlan {
  // Explicit waits/moves are ordering barriers.
  if (plan.operations.some(operation => operation.type !== "stroke")) return plan;
  if(plan.operations.some(op=>op.type==="stroke" && op.phase==="underpainting") && plan.operations.some(op=>op.type==="stroke" && op.phase!=="underpainting")) {
    const fill=optimizeStrokeOrder({...plan,operations:plan.operations.filter(op=>op.type==="stroke"&&op.phase==="underpainting")},workspace);
    const detail=optimizeStrokeOrder({...plan,operations:plan.operations.filter(op=>op.type!=="stroke"||op.phase!=="underpainting")},workspace);
    return {...plan,operations:[...fill.operations,...detail.operations]};
  }
  if (plan.operations.some(operation => operation.type === "stroke" && operation.phase === "recognition") &&
      plan.operations.some(operation => operation.type === "stroke" && operation.phase !== "recognition")) {
    const base = optimizeStrokeOrder({ ...plan, operations: plan.operations.filter(op => op.type === "stroke" && op.phase !== "recognition") }, workspace);
    const details = optimizeStrokeOrder({ ...plan, operations: plan.operations.filter(op => op.type === "stroke" && op.phase === "recognition") }, workspace);
    return { ...plan, operations: [...base.operations, ...details.operations] };
  }
  if (plan.operations.some(operation => operation.type === "stroke" && operation.phase === "shadows") &&
      plan.operations.some(operation => operation.type === "stroke" && operation.phase !== "shadows")) {
    const base = optimizeStrokeOrder({ ...plan, operations: plan.operations.filter(op => op.type === "stroke" && op.phase !== "shadows") }, workspace);
    const lastBase = base.operations.at(-1);
    const shadowOperations = plan.operations.filter((op): op is Stroke => op.type === "stroke" && op.phase === "shadows");
    if (lastBase?.type === "stroke") shadowOperations.sort((a, b) => Number(b.paintId === lastBase.paintId) - Number(a.paintId === lastBase.paintId));
    const shadows = optimizeStrokeOrder({ ...plan, operations: shadowOperations }, workspace);
    return { ...plan, operations: [...base.operations, ...shadows.operations] };
  }
  if (plan.operations.some(operation => operation.type === "stroke" && operation.phase === "contours") &&
      plan.operations.some(operation => operation.type === "stroke" && !operation.phase)) {
    const fill = optimizeStrokeOrder({ ...plan, operations: plan.operations.filter(op => op.type === "stroke" && !op.phase) }, workspace);
    const contours = optimizeStrokeOrder({ ...plan, operations: plan.operations.filter(op => op.type === "stroke" && op.phase === "contours") }, workspace);
    return { ...plan, operations: [...fill.operations, ...contours.operations] };
  }
  const canvas = workspace.zones.find(zone => zone.type === "canvas");
  if (!canvas) return plan;
  const groups = new Map<string, Stroke[]>();
  for (const operation of plan.operations) if (operation.type === "stroke") {
    const group = groups.get(operation.paintId) ?? []; group.push(operation); groups.set(operation.paintId, group);
  }
  const result: Stroke[] = [];
  for (const [paintId, group] of groups) {
    const cup = workspace.zones.find(zone => zone.type === "paint" && zone.paintId === paintId), water = workspace.zones.find(zone => zone.type === "water");
    const localCentre = (zone: typeof canvas) => ({ x: zone.x + zone.width / 2 - canvas.x, y: zone.y + zone.height / 2 - canvas.y });
    const start = cup ? localCentre(cup) : group[0].points[0], end = water ? localCentre(water) : start;
    const root = tree(group)!; let position = start;
    const ordered: Stroke[] = [];
    while (root.count) {
      const node = nearest(root, position); ordered.push(node.stroke); position = node.stroke.points.at(-1)!; node.alive = false;
      let ancestor: Node | undefined = node; while (ancestor) { ancestor.count--; ancestor = ancestor.parent; }
    }
    const candidate = routeLength(ordered, start, end) < routeLength(group, start, end) ? ordered : group;
    const refined = refineRoute(candidate, start, end);
    result.push(...(routeLength(refined, start, end) < routeLength(candidate, start, end) ? refined : candidate));
  }
  return { ...plan, operations: result };
}
