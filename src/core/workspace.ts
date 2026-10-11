import { defaultMachineSettings, machineSettingsIssues, procedureIssues, type MachineSettings, type ZoneProcedure } from "./machineSettings.ts";
export type WorkspaceZone = Readonly<{ id: string; type: "canvas" | "paint" | "water" | "wipe" | "parking" | "forbidden"; name: string; x: number; y: number; width: number; height: number; paintId?: string; procedure?: ZoneProcedure }>;
export type Workspace = Readonly<{ width: number; height: number; safeZ: number; machine?: MachineSettings; paintSlots?: readonly Readonly<{ x: number; y: number; width: number; height: number; procedure?: ZoneProcedure }>[]; zones: readonly WorkspaceZone[] }>;
import { maxPaletteColors } from "./paletteLimits.ts";
type Canvas = Readonly<{ widthMm: number; heightMm: number }>;
type Paint = Readonly<{ id: string; name: string; skipPainting: boolean }>;
export function defaultWorkspace(canvas: Canvas, paintCount = 8): Workspace {
  const x = canvas.widthMm + 100;
  const waterY = Math.max(250, 50 + Math.ceil(paintCount / 2) * 45);
  return { width: Math.max(600, x + 120), height: Math.max(600, canvas.heightMm + 100, waterY + 180), safeZ: 15, zones: [
    { id: "canvas", type: "canvas", name: "Canvas", x: 50, y: 50, width: canvas.widthMm, height: canvas.heightMm },
    { id: "water", type: "water", name: "Water", x, y: waterY, width: 60, height: 60 },
    { id: "wipe", type: "wipe", name: "Wiping area", x, y: waterY + 90, width: 70, height: 40 },
    { id: "parking", type: "parking", name: "Parking", x: 10, y: 10, width: 20, height: 20 },
  ] };
}
export function syncWorkspace(workspace: Workspace, canvas: Canvas, palette: readonly Paint[]): Workspace {
  const paints = palette.filter(paint => !paint.skipPainting);
  const zones: WorkspaceZone[] = workspace.zones.filter(zone => zone.type !== "paint" || paints.some(paint => paint.id === zone.paintId)).map(zone => {
    if (zone.type === "canvas") return { ...zone, width: canvas.widthMm, height: canvas.heightMm };
    if (zone.type === "paint") return { ...zone, name: paints.find(paint => paint.id === zone.paintId)!.name };
    return zone;
  });
  paints.forEach((paint, index) => {
    if (!zones.some(zone => zone.type === "paint" && zone.paintId === paint.id)) {
      const slot = workspace.paintSlots?.[index];
      let y = 30 + Math.floor(index / 2) * 45;
      const x = canvas.widthMm + 100 + index % 2 * 45;
      // Automatic new cups avoid existing equipment; saved physical slots win.
      if (!slot) while (zones.some(zone => x < zone.x + zone.width && x + 32 > zone.x && y < zone.y + zone.height && y + 32 > zone.y)) y += 45;
      zones.push({ id: `paint:${paint.id}`, type: "paint", paintId: paint.id, name: paint.name, x, y, width: 32, height: 32, ...slot });
    }
  });
  return { ...workspace, zones };
}
export function validateWorkspace(workspace: Workspace): string[] {
  const issues: string[] = [];
  if (![workspace.width, workspace.height, workspace.safeZ].every(Number.isFinite) || workspace.width <= 0 || workspace.height <= 0 || workspace.safeZ <= 0) issues.push("Invalid workspace dimensions or safe Z.");
  const machine = workspace.machine ?? defaultMachineSettings;
  issues.push(...machineSettingsIssues(machine));
  if (workspace.safeZ > machine.zMax || workspace.safeZ <= machine.paintZMax) issues.push("Safe Z must be above painting Z and within machine limits.");
  for (const zone of workspace.zones) {
    if (![zone.x, zone.y, zone.width, zone.height].every(Number.isFinite) || zone.width <= 0 || zone.height <= 0) issues.push(`${zone.name}: invalid geometry.`);
    if (zone.procedure) {
      issues.push(...procedureIssues(zone.procedure).map(issue => `${zone.name}: ${issue}`));
      if (zone.procedure.clearanceZ > machine.zMax || zone.procedure.clearanceZ < machine.zMin || zone.procedure.steps.some(step => step.z < machine.zMin || step.z > machine.zMax)) issues.push(`${zone.name}: procedure Z is outside machine limits.`);
    }
  }
  for (const zone of workspace.zones) if (zone.x < 0 || zone.y < 0 || zone.x + zone.width > workspace.width || zone.y + zone.height > workspace.height) issues.push(`${zone.name} is outside the working area.`);
  for (let i = 0; i < workspace.zones.length; i++) for (let j = i + 1; j < workspace.zones.length; j++) {
    const a = workspace.zones[i], b = workspace.zones[j];
    if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) issues.push(`${a.name} overlaps ${b.name}.`);
  }
  return issues;
}
export function parseWorkspace(value: unknown, canvas: Canvas): Workspace {
  if (value === undefined) return defaultWorkspace(canvas);
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!object(value) || !positive(value.width) || !positive(value.height) || !positive(value.safeZ) || !Array.isArray(value.zones) || value.zones.length > maxPaletteColors + 100) throw new Error("Invalid workspace dimensions or zones.");
  if (value.paintSlots !== undefined && (!Array.isArray(value.paintSlots) || value.paintSlots.length > maxPaletteColors || value.paintSlots.some(slot => !object(slot) || typeof slot.x !== "number" || !Number.isFinite(slot.x) || typeof slot.y !== "number" || !Number.isFinite(slot.y) || !positive(slot.width) || !positive(slot.height) || (slot.procedure !== undefined && (!object(slot.procedure) || procedureIssues(slot.procedure as unknown as ZoneProcedure).length))))) throw new Error("Invalid paint slots.");
  if (value.machine !== undefined && (!object(value.machine) || machineSettingsIssues(value.machine as unknown as MachineSettings).length)) throw new Error("Invalid machine settings.");
  const ids = new Set<string>();
  const types = ["canvas", "paint", "water", "wipe", "parking", "forbidden"];
  for (const zone of value.zones) {
    if (!object(zone) || typeof zone.id !== "string" || !zone.id || ids.has(zone.id) || typeof zone.name !== "string" || !zone.name.trim() || !types.includes(String(zone.type)) || typeof zone.x !== "number" || !Number.isFinite(zone.x) || typeof zone.y !== "number" || !Number.isFinite(zone.y) || !positive(zone.width) || !positive(zone.height) || (zone.type === "paint" && (typeof zone.paintId !== "string" || !zone.paintId))) throw new Error("Invalid workspace zone.");
    if (zone.procedure !== undefined && (!object(zone.procedure) || procedureIssues(zone.procedure as unknown as ZoneProcedure).length)) throw new Error("Invalid zone service procedure.");
    ids.add(zone.id);
  }
  for (const type of ["canvas", "water", "wipe", "parking"]) if (value.zones.filter(zone => zone.type === type).length !== 1) throw new Error(`Workspace requires one ${type} zone.`);
  const paintIds = value.zones.filter(zone => zone.type === "paint").map(zone => zone.paintId);
  if (new Set(paintIds).size !== paintIds.length) throw new Error("Duplicate paint containers.");
  return value as unknown as Workspace;
}
