import type { MachineProfile, PaintingPlan } from "./core/model.ts";
import { toGrbl } from "./core/grbl.ts";

export const referenceProfile: MachineProfile = {
  name: "M0 XYZ GRBL",
  workAreaMm: { width: 300, height: 200 },
  safeZMm: 10,
  paintZRangeMm: { min: 0, max: 2 },
  travelSpeedMmPerMin: 1500,
  park: { x: 0, y: 0, z: 10 },
};

export const referencePlan: PaintingPlan = {
  formatVersion: 1,
  projectId: "m0-reference-line",
  operations: [
    { type: "move", to: { x: 20, y: 30 } },
    {
      type: "stroke",
      points: [{ x: 20, y: 30 }, { x: 100, y: 80 }],
      paintId: "blue",
      pressure: 0.6,
      speedMmPerMin: 500,
      expectedLoadStart: 0.8,
      expectedLoadEnd: 0.35,
    },
    { type: "park" },
  ],
};

if (process.argv[1] && import.meta.filename === process.argv[1]) process.stdout.write(toGrbl(referencePlan, referenceProfile));
