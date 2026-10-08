import type { MachineProfile, PaintingPlan, Point } from "./model.ts";
import { validatePlan } from "./validation.ts";

const n = (value: number) => Number(value.toFixed(3)).toString();
const xy = (point: Point) => `X${n(point.x)} Y${n(point.y)}`;

function pressureToZ(pressure: number, profile: MachineProfile): number {
  const { min, max } = profile.paintZRangeMm;
  return max - pressure * (max - min);
}

export function toGrbl(plan: PaintingPlan, profile: MachineProfile): string {
  const errors = validatePlan(plan, profile).filter((issue) => issue.severity === "error");
  if (errors.length) throw new Error(`The plan cannot be exported: ${errors.map((e) => e.message).join(" ")}`);

  const lines = [
    "; Caravaiggio M0 prototype",
    `; project=${plan.projectId} format=${plan.formatVersion} profile=${profile.name}`,
    "G21 ; millimeters",
    "G90 ; absolute positioning",
    `G0 Z${n(profile.safeZMm)} ; tool up`,
  ];

  for (const operation of plan.operations) {
    if (operation.type === "move") {
      lines.push(`G0 Z${n(profile.safeZMm)}`, `G0 ${xy(operation.to)} F${n(operation.speedMmPerMin ?? profile.travelSpeedMmPerMin)}`);
    } else if (operation.type === "stroke") {
      const [start, ...rest] = operation.points;
      lines.push(`; stroke paint=${operation.paintId}`, `G0 Z${n(profile.safeZMm)}`, `G0 ${xy(start)} F${n(profile.travelSpeedMmPerMin)}`);
      lines.push(`G1 Z${n(pressureToZ(operation.pressure, profile))} F${n(operation.speedMmPerMin)}`);
      for (const point of rest) lines.push(`G1 ${xy(point)} F${n(operation.speedMmPerMin)}`);
      lines.push(`G0 Z${n(profile.safeZMm)}`);
    } else if (operation.type === "wait") {
      lines.push(`G4 P${n(operation.seconds)}`);
    } else {
      lines.push("; park", `G0 Z${n(profile.safeZMm)}`, `G0 X${n(profile.park.x)} Y${n(profile.park.y)} F${n(profile.travelSpeedMmPerMin)}`, `G0 Z${n(profile.park.z)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
