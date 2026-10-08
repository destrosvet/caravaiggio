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
/** Group paints, then shorten travel without reversing or changing stroke geometry. */
export function optimizeStrokeOrder(plan: PaintingPlan, workspace: Workspace): PaintingPlan {
  // Explicit waits/moves are ordering barriers and must remain intact.
  if (plan.operations.some(operation => operation.type !== "stroke")) return plan;
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
    result.push(...(routeLength(ordered, start, end) < routeLength(group, start, end) ? ordered : group));
  }
  return { ...plan, operations: result };
}
