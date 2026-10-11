import { paintUsageIssues, type PaintUsageSettings } from "./paintUsage.ts";
export type AxisValues = Readonly<{ x: number; y: number; z: number }>;
export type MotionDynamics = Readonly<{ enabled: boolean; maxRate: AxisValues; acceleration: AxisValues; junctionDeviation: number }>;
/** Illustrative values only; match the calibrated controller before enabling. Speeds mm/min, acceleration mm/s². */
export const defaultMotionDynamics: MotionDynamics = { enabled: false, maxRate: { x: 1500, y: 1500, z: 300 }, acceleration: { x: 100, y: 100, z: 30 }, junctionDeviation: .01 };
export type MachineSettings = Readonly<{ zMin: number; zMax: number; paintZMin: number; paintZMax: number; travelSpeed: number; verticalSpeed: number; optimizeOrder: boolean; cleanBeforeStart: boolean; canvasTravelZ?: number; joinStrokes?: boolean; joinGapMm?: number; dynamics?: MotionDynamics; paintUsage?: PaintUsageSettings }>;
export type ProcedureStep = Readonly<{ x: number; y: number; z: number; seconds: number }>;
export type ZoneProcedure = Readonly<{ clearanceZ: number; speed: number; repeats: number; steps: readonly ProcedureStep[] }>;
export const defaultMachineSettings: MachineSettings = { zMin: -20, zMax: 100, paintZMin: 0, paintZMax: 2, travelSpeed: 1500, verticalSpeed: 300, optimizeOrder: true, cleanBeforeStart: true };
export function defaultProcedure(type: string, safeZ: number): ZoneProcedure {
  const steps: ProcedureStep[] = type === "wipe" ? [{ x: -8, y: 0, z: 0, seconds: 0 }, { x: 8, y: 0, z: 0, seconds: 0 }, { x: 0, y: 0, z: 0, seconds: 0 }]
    : type === "water" ? [{ x: 0, y: 0, z: 0, seconds: .5 }, { x: -5, y: 0, z: 0, seconds: 0 }, { x: 5, y: 0, z: 0, seconds: 0 }, { x: 0, y: 0, z: 0, seconds: .5 }]
    : [{ x: 0, y: 0, z: 0, seconds: 1.5 }];
  return { clearanceZ: safeZ, speed: 300, repeats: type === "water" ? 3 : 1, steps };
}
export function machineSettingsIssues(settings: MachineSettings): string[] {
  const issues: string[] = [];
  if ([settings.zMin, settings.zMax, settings.paintZMin, settings.paintZMax, settings.travelSpeed, settings.verticalSpeed].some(v => !Number.isFinite(v))) issues.push("Machine settings must be finite numbers.");
  if (settings.zMin >= settings.zMax || settings.paintZMin > settings.paintZMax || settings.paintZMin < settings.zMin || settings.paintZMax > settings.zMax) issues.push("Painting Z range must lie within machine Z limits.");
  if (settings.travelSpeed <= 0 || settings.verticalSpeed <= 0) issues.push("Machine speeds must be positive.");
  if (typeof settings.optimizeOrder !== "boolean" || typeof settings.cleanBeforeStart !== "boolean") issues.push("Invalid stroke ordering setting.");
  if (settings.canvasTravelZ !== undefined && (!Number.isFinite(settings.canvasTravelZ) || settings.canvasTravelZ <= settings.paintZMax || settings.canvasTravelZ > settings.zMax)) issues.push("Canvas travel Z must be above painting Z and within machine limits.");
  if (settings.joinStrokes !== undefined && typeof settings.joinStrokes !== "boolean") issues.push("Invalid stroke joining option.");
  if (settings.joinGapMm !== undefined && (!Number.isFinite(settings.joinGapMm) || settings.joinGapMm < 0 || settings.joinGapMm > 50)) issues.push("Connection gap must be between 0 and 50 mm.");
  if (settings.dynamics !== undefined) {
    const d = settings.dynamics;
    if (!d || typeof d.enabled !== "boolean" || !d.maxRate || !d.acceleration || [d.maxRate?.x, d.maxRate?.y, d.maxRate?.z, d.acceleration?.x, d.acceleration?.y, d.acceleration?.z, d.junctionDeviation].some(v => !Number.isFinite(v) || v <= 0)) issues.push("Motion limits and junction deviation must be finite positive numbers.");
    else if (d.junctionDeviation < .01 || d.junctionDeviation > 1) issues.push("FluidNC junction deviation must be between 0.01 and 1 mm.");
  }
  if (settings.paintUsage !== undefined) issues.push(...paintUsageIssues(settings.paintUsage));
  return issues;
}
export function procedureIssues(procedure: ZoneProcedure): string[] {
  if (!procedure || !Number.isFinite(procedure.clearanceZ) || !Number.isFinite(procedure.speed) || procedure.speed <= 0 || !Number.isInteger(procedure.repeats) || procedure.repeats < 1 || procedure.repeats > 100 || !Array.isArray(procedure.steps) || procedure.steps.length < 1 || procedure.steps.length > 100) return ["Invalid service procedure settings."];
  if (procedure.steps.some(step => !step || [step.x, step.y, step.z, step.seconds].some(v => !Number.isFinite(v)) || step.seconds < 0)) return ["Service points and dwell times must be finite; dwell cannot be negative."];
  if (procedure.steps.some(step => step.z >= procedure.clearanceZ)) return ["Service points must be below the container clearance Z."];
  return [];
}
