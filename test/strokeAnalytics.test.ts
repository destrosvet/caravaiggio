import assert from "node:assert/strict";
import test from "node:test";
import { analyzeStrokes } from "../src/core/strokeAnalytics.ts";
import type { PaintingPlan, Stroke } from "../src/core/model.ts";
const stroke=(paintId:string,points:Stroke["points"]):Stroke=>({type:"stroke",paintId,points,pressure:.5,speedMmPerMin:300,expectedLoadStart:1,expectedLoadEnd:0});
test("analysis uses full polyline length, ignores nonpainting operations and honours bin boundaries",()=>{
  const plan:PaintingPlan={formatVersion:1,projectId:"test",operations:[stroke("red",[{x:0,y:0},{x:1,y:0}]),{type:"move",to:{x:100,y:100}},stroke("red",[{x:0,y:0},{x:3,y:4},{x:6,y:8}]),stroke("blue",[{x:0,y:0},{x:2,y:0}]),stroke("blue",[{x:0,y:0},{x:0,y:0}])]};
  const data=analyzeStrokes(plan,2);
  assert.equal(data.count,4);assert.equal(data.totalDistanceMm,13);assert.equal(data.medianMm,1.5);assert.equal(data.shortCount,3);assert.equal(data.colourChanges,1);
  assert.equal(data.rows[0].paintId,"red");assert.equal(data.rows[0].distanceMm,11);assert.equal(data.rows[0].bins[0],1);assert.equal(data.rows[0].bins[3],1);assert.equal(data.rows[1].bins[0],1);assert.equal(data.rows[1].bins[1],1);
});
test("bounded colour sequence preserves every stroke, last partial window and empty plans",()=>{
  const plan:PaintingPlan={formatVersion:1,projectId:"test",operations:Array.from({length:1001},(_,i)=>stroke(i%2?"red":"blue",[{x:0,y:0},{x:1,y:0}]))};
  const data=analyzeStrokes(plan,2);
  assert.ok(data.sequence.length<=120);assert.equal(data.sequence[0].start,1);assert.equal(data.sequence.at(-1)?.end,1001);
  assert.equal(data.sequence.reduce((sum,w)=>sum+[...w.counts.values()].reduce((a,b)=>a+b,0),0),1001);
  assert.equal(data.colourChanges,1000);
  const empty=analyzeStrokes({...plan,operations:[]},2);assert.equal(empty.count,0);assert.equal(empty.medianMm,0);assert.deepEqual(empty.sequence,[]);
});
