import assert from "node:assert/strict";
import test from "node:test";
import { joinMachineStrokes } from "../src/core/machineStrokeJoining.ts";
import { buildMachineProgram, machineProgramToGrbl } from "../src/core/machineProgram.ts";
import { createProject } from "../src/project/model.ts";
import { defaultMachineSettings } from "../src/core/machineSettings.ts";
import type { PaintingPlan, Stroke } from "../src/core/model.ts";
const stroke=(x:number,y=20):Stroke=>({type:"stroke",points:[{x,y},{x:x+2,y}],paintId:"cadmium-red",pressure:.5,speedMmPerMin:300,expectedLoadStart:1,expectedLoadEnd:.9});
const plan=(...operations:Stroke[]):PaintingPlan=>({formatVersion:1,projectId:"test",operations});
const canvas={widthMm:300,heightMm:400};
const map={widthPx:300,heightPx:400,paintIds:["cadmium-red","ultramarine-blue"],pixels:new Uint8Array(120000)};
test("nearby strokes form one chain without reversing geometry; bridge respects the entire footprint",()=>{
  const source=plan(stroke(10),stroke(13),stroke(16));
  const joined=joinMachineStrokes(source,map,canvas,2,1);
  assert.equal(joined.joins,2);assert.equal(joined.addedDistance,2);assert.equal(joined.plan.operations.length,1);
  assert.deepEqual(joined.plan.operations[0].type==="stroke"&&joined.plan.operations[0].points,source.operations.flatMap(s=>s.type==="stroke"?s.points:[]));
  for(const value of [1,255]) {
    const masked={...map,pixels:new Uint8Array(map.pixels)};
    masked.pixels[19*300+12]=value;
    assert.equal(joinMachineStrokes(plan(stroke(10),stroke(13)),masked,canvas,2,1).joins,0);
  }
});
test("joining preserves paint, pressure, speed and phase barriers and stays within canvas bounds",()=>{
  const a=stroke(10),b=stroke(13);
  for(const next of [{...b,paintId:"ultramarine-blue"},{...b,pressure:.6},{...b,speedMmPerMin:400},{...b,phase:"contours" as const}]) assert.equal(joinMachineStrokes(plan(a,next),map,canvas,2,3).joins,0);
  assert.equal(joinMachineStrokes(plan({...a,phase:"shadows"},{...b,phase:"shadows"}),map,canvas,2,3).joins,0);
  assert.equal(joinMachineStrokes(plan(stroke(10,.5),stroke(13,.5)),map,canvas,2,3).joins,0);
  assert.equal(joinMachineStrokes(plan(a,b),map,canvas,2,.5).joins,0);
});
test("machine joining reduces actual execution time and reloads still resume correctly",()=>{
  const project=createProject(), source=plan(...Array.from({length:12},(_,i)=>stroke(10+i*3)));
  const workspace={...project.workspace,machine:{...defaultMachineSettings,optimizeOrder:false,joinStrokes:true,joinGapMm:1}};
  const joined=buildMachineProgram(source,workspace,1000,2,map);
  const before=buildMachineProgram(source,{...workspace,machine:{...workspace.machine,joinStrokes:false}},1000,2);
  assert.deepEqual(joined.issues,[]);assert.equal(joined.timeline.strokes,1);
  assert.equal(joined.optimization?.joins,11);assert.ok(joined.timeline.duration<before.timeline.duration);
  assert.equal(joined.timeline.paintDistance,35);assert.equal(joined.optimization?.addedPaintingMm,11);
  assert.ok(joined.optimization!.savedSeconds>0);assert.match(machineProgramToGrbl(joined,"test"),/; stroke/);
  const split=buildMachineProgram(source,workspace,20,2,map);
  assert.deepEqual(split.issues,[]);assert.ok(split.timeline.loads>1);
  assert.equal(split.optimization?.rejected,false);
  const rejected=buildMachineProgram(source,workspace,8,2,map);
  assert.equal(rejected.optimization?.rejected,true);
  assert.equal(rejected.optimization?.joins,0);
  const marks=split.motions.filter(m=>m.type==="stroke");
  for(let i=1;i<marks.length;i++) assert.deepEqual(marks[i-1].to,marks[i].from);
});
test("separate canvas clearance saves lifts but cup travel remains above all rims",()=>{
  const project=createProject(),source=plan(stroke(10),stroke(30),stroke(50));
  const workspace={...project.workspace,machine:{...defaultMachineSettings,optimizeOrder:false,canvasTravelZ:3}};
  const program=buildMachineProgram(source,workspace,1000,2);
  const before=buildMachineProgram(source,{...workspace,machine:{...workspace.machine,canvasTravelZ:15}},1000,2);
  assert.deepEqual(program.issues,[]);assert.ok(program.timeline.duration<before.timeline.duration);
  const travels=program.motions.filter(m=>m.type==="move"&&(m.from.x!==m.to.x||m.from.y!==m.to.y));
  assert.ok(travels.some(m=>m.to.z===3));assert.ok(travels.some(m=>m.to.z===15));
  for(const m of travels.filter(m=>m.to.z===3)) for(const p of [m.from,m.to]) assert.ok(p.x>=50&&p.x<=350&&p.y>=50&&p.y<=450);
  assert.equal(program.timeline.paintDistance,before.timeline.paintDistance);
  assert.equal(program.timeline.loads,before.timeline.loads);
});
