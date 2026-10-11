import assert from "node:assert/strict";
import test from "node:test";
import { estimatePaintUsage, defaultPaintUsageSettings } from "../src/core/paintUsage.ts";
import { buildMachineProgram } from "../src/core/machineProgram.ts";
import { defaultMachineSettings, defaultProcedure } from "../src/core/machineSettings.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
import type { PaintingPlan, Stroke } from "../src/core/model.ts";
const stroke=(paintId:string,length:number):Stroke=>({type:"stroke",points:[{x:10,y:20},{x:10+length,y:20}],paintId,pressure:.5,speedMmPerMin:300,expectedLoadStart:1,expectedLoadEnd:0});
test("per-colour quantities use painting length and count services once despite repetitions and dwell",()=>{
  const project=createProject(),paintUsage={mlPerMetre:2,wastePerCleaningMl:.1};
  const workspace={...project.workspace,machine:{...defaultMachineSettings,paintUsage},zones:project.workspace.zones.map(z=>["paint","water","wipe"].includes(z.type)?{...z,procedure:{...defaultProcedure(z.type,15),repeats:4}}:z)};
  const plan:PaintingPlan={formatVersion:1,projectId:"test",operations:[stroke("cadmium-red",150),stroke("ultramarine-blue",50)]};
  const program=buildMachineProgram(plan,workspace,50,6);
  assert.deepEqual(program.issues,[]);
  const rows=estimatePaintUsage(program.timeline,paintUsage);
  assert.equal(rows.length,2);
  const red=rows.find(r=>r.paintId==="cadmium-red")!,blue=rows.find(r=>r.paintId==="ultramarine-blue")!;
  assert.equal(red.distanceMm,150);assert.equal(red.loads,3);assert.equal(red.cleans,1);
  assert.equal(blue.distanceMm,50);assert.equal(blue.loads,1);assert.equal(blue.cleans,1);
  assert.ok(Math.abs(red.totalMl-.4)<1e-9);assert.ok(Math.abs(blue.totalMl-.2)<1e-9);
  assert.equal(rows.reduce((s,r)=>s+r.distanceMm,0),program.timeline.paintDistance);
  assert.equal(rows.reduce((s,r)=>s+r.loads,0),program.timeline.loads);
  assert.equal(rows.reduce((s,r)=>s+r.cleans,0),program.timeline.cleans-1); // Initial washing of an empty brush has no colour waste.
  assert.deepEqual(parseProject(serializeProject({...project,workspace})).workspace.machine?.paintUsage,paintUsage);
});
test("empty plans consume zero; coefficient validation rejects invalid saved and calculated values",()=>{
  const project=createProject(),plan:PaintingPlan={formatVersion:1,projectId:"test",operations:[]};
  const timeline=buildMachineProgram(plan,project.workspace,120,6).timeline;
  assert.deepEqual(estimatePaintUsage(timeline,defaultPaintUsageSettings),[]);
  for(const paintUsage of [{mlPerMetre:0,wastePerCleaningMl:0},{mlPerMetre:1,wastePerCleaningMl:-1},{mlPerMetre:NaN,wastePerCleaningMl:0}]) {
    assert.throws(()=>estimatePaintUsage(timeline,paintUsage),/Invalid paint/);
    assert.throws(()=>parseProject(JSON.stringify({...project,workspace:{...project.workspace,machine:{...defaultMachineSettings,paintUsage}}})),/Invalid machine/);
  }
});
