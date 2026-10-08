import type { MachineProfile, PaintingPlan, Point } from "./model.ts";

export type ValidationIssue = Readonly<{
  severity: "error" | "warning";
  operationIndex?: number;
  message: string;
}>;

function pointIssue(point: Point, profile: MachineProfile): string | undefined {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return "Coordinates must be finite numbers.";
  if (point.x < 0 || point.y < 0 || point.x > profile.workAreaMm.width || point.y > profile.workAreaMm.height) {
    return `Point X${point.x} Y${point.y} is outside the working area.`;
  }
}

export function validatePlan(plan: PaintingPlan, profile: MachineProfile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (plan.formatVersion !== 1) issues.push({ severity: "error", message: "Unsupported plan version." });

  plan.operations.forEach((operation, operationIndex) => {
    const points = operation.type === "move" ? [operation.to] : operation.type === "stroke" ? operation.points : [];
    for (const point of points) {
      const message = pointIssue(point, profile);
      if (message) issues.push({ severity: "error", operationIndex, message });
    }
    if (operation.type === "stroke") {
      if (operation.speedMmPerMin <= 0) issues.push({ severity: "error", operationIndex, message: "Stroke speed must be positive." });
      if (operation.pressure < 0 || operation.pressure > 1) issues.push({ severity: "error", operationIndex, message: "Pressure must be between 0 and 1." });
      if (!operation.paintId.trim()) issues.push({ severity: "error", operationIndex, message: "A stroke must reference a paint." });
    }
    if (operation.type === "wait" && operation.seconds < 0) {
      issues.push({ severity: "error", operationIndex, message: "Wait duration cannot be negative." });
    }
  });
  return issues;
}
