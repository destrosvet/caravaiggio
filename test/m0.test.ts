import assert from "node:assert/strict";
import test from "node:test";
import { toGrbl } from "../src/core/grbl.ts";
import type { PaintingPlan } from "../src/core/model.ts";
import { validatePlan } from "../src/core/validation.ts";
import { referencePlan, referenceProfile } from "../src/demo.ts";

test("the reference stroke passes validation and creates a safe GRBL program", () => {
  assert.deepEqual(validatePlan(referencePlan, referenceProfile), []);
  const gcode = toGrbl(referencePlan, referenceProfile);
  assert.match(gcode, /G21/);
  assert.match(gcode, /G90/);
  assert.match(gcode, /G0 Z10[\s\S]*G0 X20 Y30[\s\S]*G1 Z0\.8[\s\S]*G1 X100 Y80[\s\S]*; park/);
});

test("export rejects a stroke outside the working area", () => {
  const invalid: PaintingPlan = { ...referencePlan, operations: [{ ...referencePlan.operations[1], points: [{ x: 20, y: 30 }, { x: 301, y: 80 }] }] as PaintingPlan["operations"] };
  assert.throws(() => toGrbl(invalid, referenceProfile), /outside the working area/);
});
