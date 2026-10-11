import assert from "node:assert/strict";
import test from "node:test";
import {runCalculation} from "../src/platform/runCalculation.ts";
import {createProject} from "../src/project/model.ts";
import {executeCalculation} from "../src/platform/calculations.ts";
const project=createProject();
const request={kind:"paths" as const,plan:{formatVersion:1 as const,projectId:"test",operations:[]},workspace:project.workspace,capacity:120,brushWidth:6};
test("worker progress reaches the caller, returns the result and releases the worker",async context=>{
 const original=globalThis.Worker;context.after(()=>{globalThis.Worker=original;});
 let active:any,terminated=0;
 class FakeWorker{onmessage:any;onerror:any;constructor(){active=this;}postMessage(value:unknown){assert.equal(value,request);}terminate(){terminated++;}}
 globalThis.Worker=FakeWorker as unknown as typeof Worker;
 const stages:string[]=[];
 const pending=runCalculation<"paths">(request,stage=>stages.push(stage),new AbortController().signal);
 active.onmessage({data:{type:"progress",stage:"Routing…"}});
 const expected=executeCalculation(request,()=>{});
 active.onmessage({data:{type:"result",result:expected}});
 assert.deepEqual(await pending,expected);assert.deepEqual(stages,["Routing…"]);assert.equal(terminated,1);
});
test("cancelling terminates the worker and refuses a late result",async context=>{
 const original=globalThis.Worker;context.after(()=>{globalThis.Worker=original;});
 let active:any,terminated=0;
 class FakeWorker{onmessage:any;onerror:any;constructor(){active=this;}postMessage(){}terminate(){terminated++;}}
 globalThis.Worker=FakeWorker as unknown as typeof Worker;
 const controller=new AbortController(),pending=runCalculation<"paths">(request,()=>{},controller.signal);
 const rejected=assert.rejects(pending,/cancelled/);controller.abort();
 active.onmessage({data:{type:"result",result:executeCalculation(request,()=>{})}});
 await rejected;assert.ok(terminated>=1);
});
test("worker calculation errors reach the caller and dispose the worker",async context=>{
 const original=globalThis.Worker;context.after(()=>{globalThis.Worker=original;});
 let active:any,terminated=0;
 class FakeWorker{onmessage:any;onerror:any;constructor(){active=this;}postMessage(){}terminate(){terminated++;}}
 globalThis.Worker=FakeWorker as unknown as typeof Worker;
 const pending=runCalculation<"paths">(request,()=>{},new AbortController().signal);
 active.onmessage({data:{type:"error",error:"Invalid XYZ limits"}});
 await assert.rejects(pending,/Invalid XYZ/);assert.equal(terminated,1);
});
test("stroke and preview jobs retain the normal output while publishing meaningful stages",()=>{
 const pixels=new Uint8ClampedArray(10*10*4);for(let i=0;i<100;i++)pixels.set([190,40,30,255],i*4);
 const stages:string[]=[];
 const result=executeCalculation({kind:"strokes",project,pixels,width:10,height:10,seed:"progress"},stage=>stages.push(stage));
 assert.ok("plan" in result);if(!("plan" in result))return;
 assert.ok(result.plan.operations.length>0);assert.equal(result.regionMap.pixels.length,100);
 assert.ok(stages.some(s=>s.includes("Generating strokes")));
 const preview=executeCalculation({kind:"preview",project:{...project,canvas:{...project.canvas,widthMm:10,heightMm:10}},plan:{...result.plan,operations:[]}},stage=>stages.push(stage));
 assert.ok("rgba" in preview);if("rgba" in preview)assert.equal(preview.rgba.length,preview.width*preview.height*4);
 assert.ok(stages.some(s=>s.includes("Rendering paint")));
});
