import assert from "node:assert/strict";
import test from "node:test";
import { buildMachineProgram, machineProgramToGrbl, routeTravel } from "../src/core/machineProgram.ts";
import { segmentIntersectsZone } from "../src/core/simulation.ts";
import { defaultMachineSettings, defaultProcedure } from "../src/core/machineSettings.ts";
import type { PaintingPlan, Stroke } from "../src/core/model.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
import { captureLayout, applyLayoutProfile, parseLayoutProfiles } from "../src/project/workspaceProfiles.ts";
const stroke = (paintId = "cadmium-red", y = 20): Stroke => ({ type:"stroke",points:[{x:10,y},{x:160,y}],paintId,pressure:.5,speedMmPerMin:300,expectedLoadStart:1,expectedLoadEnd:0 });
const plan = (...operations: Stroke[]): PaintingPlan => ({formatVersion:1,projectId:"test",operations});
test("XYZ service plan resumes exhausted strokes exactly and raises before travel",()=>{
  const project=createProject();
  const program=buildMachineProgram(plan(stroke()),project.workspace,50,6);
  assert.deepEqual(program.issues,[]);
  assert.equal(program.timeline.loads,3);
  assert.equal(program.timeline.paintDistance,150);
  const paint=program.motions.filter(m=>m.type==="stroke");
  assert.equal(paint.length,3);
  assert.deepEqual(paint[0].to,paint[1].from);
  assert.deepEqual(paint[1].to,paint[2].from);
  for(const motion of program.motions) if(motion.type==="move" && (motion.from.x!==motion.to.x||motion.from.y!==motion.to.y)) {
    assert.equal(motion.from.z,program.clearanceZ);assert.equal(motion.to.z,program.clearanceZ);
  }
  assert.equal(program.motions.at(-1)?.type,"park");
  assert.equal(program.motions.at(-1)?.to.z,program.clearanceZ);
  for(let i=1;i<program.motions.length;i++) assert.deepEqual(program.motions[i-1].to,program.motions[i].from);
  for(let i=1;i<program.timeline.events.length;i++) assert.equal(program.timeline.events[i-1].end,program.timeline.events[i].start);
});
test("per-container sequences dip vertically, repeat washing and wipe before next colour",()=>{
  const project=createProject();
  const water={clearanceZ:40,speed:200,repeats:2,steps:[{x:-4,y:0,z:-3,seconds:.2},{x:4,y:0,z:-3,seconds:0}]};
  const workspace={...project.workspace,machine:{...defaultMachineSettings,optimizeOrder:false},zones:project.workspace.zones.map(zone=>zone.type==="water"?{...zone,procedure:water}:zone)};
  const program=buildMachineProgram(plan(stroke(),stroke("ultramarine-blue",40)),workspace,1000,6);
  assert.deepEqual(program.issues,[]);assert.equal(program.clearanceZ,40);
  const transitions=program.motions.filter(m=>["load","clean","wipe"].includes(m.type)).map(m=>m.type).filter((type,index,types)=>index===0||type!==types[index-1]);
  assert.deepEqual(transitions,["clean","wipe","load","clean","wipe","load","clean","wipe"]);
  const clean=program.motions.filter(m=>m.type==="clean");
  assert.equal(clean.filter(m=>m.to.z===-3&&m.to.x!==m.from.x).length,9);
  const first=clean[0];assert.equal(first.from.x,first.to.x);assert.equal(first.from.y,first.to.y);assert.equal(first.from.z,40);assert.equal(first.to.z,-3);
  const code=machineProgramToGrbl(program,"a\nG0 X999 ; unsafe");
  assert.match(code,/G1 .*Z-3 F200/);assert.match(code,/G4 P0.2/);
  assert.ok(!code.includes("\nG0 X999"));
});
test("export contains every simulated XYZ movement and dwell; dry run never lowers",()=>{
  const project=createProject();const program=buildMachineProgram(plan(stroke()),project.workspace,100,6);
  const code=machineProgramToGrbl(program,"test");
  let position=program.motions[0].from;let seconds=0;let moves=0;
  const commands=code.split("\n").filter(line=>line.startsWith("G1 ")||line.startsWith("G4 "));
  for(const line of commands) {
    if(line.startsWith("G4 ")){seconds+=Number(line.match(/P([\d.]+)/)![1]);continue;}
    const n=(axis:string)=>Number(line.match(new RegExp(axis+"(-?[0-9.]+)"))![1]);
    const next={x:n("X"),y:n("Y"),z:n("Z")};
    seconds+=Math.hypot(next.x-position.x,next.y-position.y,next.z-position.z)/n("F")*60;position=next;moves++;
  }
  assert.equal(moves,program.motions.filter(m=>Math.hypot(m.to.x-m.from.x,m.to.y-m.from.y,m.to.z-m.from.z)>0).length);
  assert.ok(Math.abs(seconds-program.timeline.duration)<.001);
  assert.deepEqual(position,program.motions.at(-1)!.to);
  const dry=machineProgramToGrbl(program,"test",true);
  for(const match of dry.matchAll(/Z(-?[\d.]+)/g)) assert.equal(Number(match[1]),program.clearanceZ);
  assert.ok(!dry.includes("G4"));assert.match(dry,/G21\nG90\nG94/);
});
test("travel avoids forbidden rectangles with brush clearance; unreachable routes block export",()=>{
  const obstacle={id:"clamp",name:"Clamp",type:"forbidden" as const,x:40,y:100,width:20,height:30};
  const workspace={...createProject().workspace,zones:[obstacle]};
  const route=routeTravel({x:10,y:110},{x:100,y:110},workspace,3)!;
  assert.ok(route.length>1);let from={x:10,y:110};
  for(const to of route){assert.equal(segmentIntersectsZone(from,to,obstacle,3),false);from=to;}
  const wall={...obstacle,x:40,y:0,width:20,height:workspace.height};
  assert.equal(routeTravel({x:10,y:110},{x:100,y:110},{...workspace,zones:[wall]},3),null);
  const project=createProject();
  const blocked=buildMachineProgram(plan(stroke()),{...project.workspace,zones:[...project.workspace.zones,{...wall,x:40,width:5}]},100,6);
  assert.ok(blocked.issues.length);assert.throws(()=>machineProgramToGrbl(blocked,"test"),/Cannot export/);
});
test("machine planning rejects invalid Z, service footprints, pressure and forbidden painting",()=>{
  const project=createProject();
  const zone=project.workspace.zones.find(z=>z.type==="paint")!;
  const workspace={...project.workspace,zones:project.workspace.zones.map(z=>z.id===zone.id?{...z,procedure:{...defaultProcedure(z.type,15),steps:[{x:30,y:0,z:0,seconds:0}]}}:z)};
  assert.ok(buildMachineProgram(plan(stroke()),workspace,100,6).issues.some(i=>i.includes("does not fit")));
  assert.ok(buildMachineProgram(plan({...stroke(),pressure:NaN}),project.workspace,100,6).issues.length);
  assert.ok(buildMachineProgram(plan({...stroke(),points:[{x:-1,y:0},{x:10,y:0}]}),project.workspace,100,6).issues.length);
  assert.ok(buildMachineProgram(plan(stroke()),{...project.workspace,machine:{...defaultMachineSettings,zMax:10}},100,6).issues.length);
  assert.ok(buildMachineProgram(plan(stroke()),project.workspace,NaN,6).issues.length);
  assert.ok(buildMachineProgram(plan(stroke()),project.workspace,100,NaN).issues.length);
  assert.ok(buildMachineProgram(plan(stroke("missing")),project.workspace,100,6).issues.some(i=>i.includes("Missing paint")));
});
test("container procedures survive project and reusable layout profile round trips",()=>{
  const project=createProject();const procedure={...defaultProcedure("paint",30),repeats:4};
  const workspace={...project.workspace,machine:{...defaultMachineSettings,verticalSpeed:222},zones:project.workspace.zones.map(z=>z.type==="paint"?{...z,procedure}:z)};
  assert.deepEqual(parseProject(serializeProject({...project,workspace})).workspace,workspace);
  const profile={id:"machine",name:"Machine",workspace:captureLayout(workspace)};
  const parsed=parseLayoutProfiles(JSON.stringify({version:1,defaultId:"machine",profiles:[profile]}));
  const restored=applyLayoutProfile(parsed.profiles[0],project);
  assert.deepEqual(restored.zones.find(z=>z.type==="paint")?.procedure,procedure);
  assert.equal(restored.machine?.verticalSpeed,222);
  assert.throws(()=>parseProject(JSON.stringify({...project,workspace:{...workspace,machine:{...defaultMachineSettings,verticalSpeed:null}}})),/Invalid machine/);
  assert.throws(()=>parseProject(JSON.stringify({...project,workspace:{...workspace,zones:workspace.zones.map(z=>z.type==="water"?{...z,procedure:{...procedure,steps:[{x:0,y:0,z:0,seconds:-1}]}}:z)}})),/Invalid zone service/);
});

test("complete machine travel detours around a clamp while forbidden paint remains blocked",()=>{
  const project=createProject();
  const clamp={id:"clamp",name:"Clamp",type:"forbidden" as const,x:40,y:0,width:5,height:40};
  const workspace={...project.workspace,zones:[...project.workspace.zones,clamp]};
  const program=buildMachineProgram(plan(stroke()),workspace,100,6);
  assert.deepEqual(program.issues,[]);
  for(const motion of program.motions) assert.equal(segmentIntersectsZone(motion.from,motion.to,clamp,3),false);
  const edge={...clamp,x:351,y:65,width:5,height:10};
  const painting=buildMachineProgram(plan({...stroke(),points:[{x:10,y:20},{x:300,y:20}]}),{...project.workspace,zones:[...project.workspace.zones,edge]},1000,6);
  assert.ok(painting.issues.some(issue=>issue.includes("intersects forbidden")));
  assert.throws(()=>machineProgramToGrbl(painting,"test"),/Cannot export/);
});
