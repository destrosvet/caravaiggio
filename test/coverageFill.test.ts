import test from "node:test";
import assert from "node:assert/strict";
import {addCoverageFill,strokeCoverage} from "../src/core/coverageFill.ts";
import {generateStyledStrokes,strokeStylePresets} from "../src/core/strokes.ts";
import {optimizeStrokeOrder} from "../src/core/strokeOrdering.ts";
import {createProject} from "../src/project/model.ts";
import {syncWorkspace} from "../src/core/workspace.ts";
import type {PaintingPlan} from "../src/core/model.ts";
const canvas={widthMm:40,heightMm:30},brush={name:"brush",shape:"round" as const,widthMm:4};
const settings={...strokeStylePresets.realism.settings,strategy:"flow-curves" as const,minStrokeLengthMm:4,maxStrokeLengthMm:15,seed:"coverage"};
const pixels=new Uint8Array(80*60);for(let y=0;y<60;y++)for(let x=0;x<80;x++)pixels[y*80+x]=x===40?255:(x+y)%5===0?1:0;
const map={widthPx:80,heightPx:60,paintIds:["a","b"],pixels,fillGaps:true};
const empty:PaintingPlan={formatVersion:1,projectId:"test",operations:[]};
test("underpainting covers fragmented colour regions without tracing every hair or entering the canvas mask",()=>{
 const plan=addCoverageFill(empty,map,canvas,brush,settings);
 assert.equal(plan.coverageStats?.uncoveredAfter,0);
 assert.ok(plan.operations.length<map.pixels.length/5);
 const coverage=strokeCoverage(plan,map,canvas,brush);
 for(let i=0;i<pixels.length;i++)if(pixels[i]!==255)assert.equal(coverage[i],1);
 for(const stroke of plan.operations)if(stroke.type==="stroke"){
  assert.equal(stroke.phase,"underpainting");
  assert.ok(stroke.points.slice(1).reduce((sum,q,i)=>sum+Math.hypot(q.x-stroke.points[i].x,q.y-stroke.points[i].y),0)<=15+1e-6);
  for(const q of stroke.points)assert.notEqual(pixels[Math.floor(q.y/.5)*80+Math.floor(q.x/.5)],255);
 }
});
test("only missing footprints get filled and explicit gaps or zero pressure remain unchanged",()=>{
 const filled=addCoverageFill(empty,map,canvas,brush,settings);
 const again=addCoverageFill(filled,map,canvas,brush,settings);
 assert.equal(again.operations.length,filled.operations.length);
 assert.equal(again.coverageStats?.strokes,0);
 assert.equal(addCoverageFill(empty,{...map,fillGaps:false},canvas,brush,settings),empty);
 assert.equal(addCoverageFill(empty,map,canvas,brush,{...settings,pressure:0}),empty);
 for(const strategy of ["dabs","decorative-lines"] as const)assert.equal(addCoverageFill(empty,map,canvas,brush,{...settings,strategy}),empty);
});
test("generation and optimization keep underpainting before artistic and recognition strokes",()=>{
 const recognitionMap=new Uint8Array(pixels.length);recognitionMap[500]=255;
 const plan=generateStyledStrokes("test",{...map,recognitionMap},canvas,brush,settings);
 assert.ok(plan.coverageStats!.strokes>0);assert.ok(plan.recognitionStats!.strokes>0);
 const project=createProject(),palette=project.palette.slice(0,2).map((p,i)=>({...p,id:map.paintIds[i],skipPainting:false}));
 const workspace=syncWorkspace(project.workspace,canvas,palette);
 const ordered=optimizeStrokeOrder(plan,workspace);
 let seenArt=false,seenRecognition=false;
 for(const op of ordered.operations)if(op.type==="stroke"){
  if(op.phase!=="underpainting")seenArt=true;
  if(op.phase==="underpainting")assert.equal(seenArt,false);
  if(op.phase==="recognition")seenRecognition=true;
  if(seenRecognition)assert.equal(op.phase,"recognition");
 }
 assert.equal(ordered.operations.length,plan.operations.length);
});

test("fills inherit vertical artistic direction rather than adding horizontal scan lines",()=>{
 const solid={...map,pixels:new Uint8Array(map.pixels.length)};
 const artistic:PaintingPlan={...empty,operations:[{type:"stroke",paintId:"a",points:[{x:20,y:0},{x:20,y:30}],pressure:.45,speedMmPerMin:400,expectedLoadStart:1,expectedLoadEnd:.9}]};
 const result=addCoverageFill(artistic,solid,canvas,brush,settings);
 assert.equal(result.coverageStats?.uncoveredAfter,0);
 for(const op of result.operations)if(op.type==="stroke"&&op.phase==="underpainting"){
   assert.ok(Math.abs(op.points.at(-1)!.x-op.points[0].x)<1e-5);
   assert.ok(Math.abs(op.points.at(-1)!.y-op.points[0].y)>0);
 }
});
test("fills bend with nearby artistic curves while retaining complete coverage and maximum length",()=>{
 const solid={...map,pixels:new Uint8Array(map.pixels.length)};
 const points=Array.from({length:61},(_,i)=>({x:5+i*.5,y:5+((5+i*.5)-20)**2*.015}));
 const artistic:PaintingPlan={...empty,operations:[{type:"stroke",paintId:"a",points:[points[0],points[1],...points.slice(2)],pressure:.45,speedMmPerMin:400,expectedLoadStart:1,expectedLoadEnd:.9}]};
 const result=addCoverageFill(artistic,solid,canvas,brush,settings);
 assert.equal(result.coverageStats?.uncoveredAfter,0);
 const fills=result.operations.filter(op=>op.type==="stroke"&&op.phase==="underpainting");
 assert.ok(fills.some(op=>{if(op.type!=="stroke"||op.points.length<5)return false;const a=op.points[0],b=op.points[1],c=op.points.at(-2)!,d=op.points.at(-1)!;return Math.abs(Math.atan2(b.y-a.y,b.x-a.x)-Math.atan2(d.y-c.y,d.x-c.x))>.02;}));
 for(const op of fills)if(op.type==="stroke")assert.ok(op.points.slice(1).reduce((sum,q,i)=>sum+Math.hypot(q.x-op.points[i].x,q.y-op.points[i].y),0)<=15+1e-6);
});
