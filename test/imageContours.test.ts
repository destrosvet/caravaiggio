import assert from "node:assert/strict";
import test from "node:test";
import { cannyEdges, imageContourStrokes } from "../src/core/imageContours.ts";
import { generateStyledStrokes } from "../src/core/strokes.ts";
import { optimizeStrokeOrder } from "../src/core/strokeOrdering.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
const settings = {style:"realism" as const,seed:"test",geometry:"linear" as const,curvature:0,direction:"image-contours" as const,overlap:.2,speedMmPerMin:600,pressure:.5,minStrokeLengthMm:5,maxStrokeLengthMm:25,contourSmoothing:.2,contourSensitivity:.8,contourGapMm:2};
const w=64,h=64;
const image=(contrast:number)=>Float32Array.from({length:w*h},(_,i)=>i%w<32?0:contrast);
test("Canny ignores constant images and threshold controls weak connected edges",()=>{
  assert.equal(cannyEdges(new Float32Array(w*h).fill(.5),w,h).reduce((a,b)=>a+b,0),0);
  assert.equal(cannyEdges(image(.12),w,h,.2,0).reduce((a,b)=>a+b,0),0);
  assert.ok(cannyEdges(image(.12),w,h,.2,1).reduce((a,b)=>a+b,0)>40);
});
test("original image details become bounded contours inside one palette colour",()=>{
  const map={widthPx:w,heightPx:h,paintIds:["gold"],pixels:new Uint8Array(w*h),luminance:image(1)};
  const strokes=imageContourStrokes(map,{widthMm:64,heightMm:64},settings);
  assert.ok(strokes.length>0);
  for(const stroke of strokes){
    const length=stroke.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-stroke.points[i].x,p.y-stroke.points[i].y),0);
    assert.ok(length>=5-1e-6&&length<=25+1e-6);assert.equal(stroke.paintId,"gold");assert.equal(stroke.phase,"contours");
  }
  assert.deepEqual(imageContourStrokes({...map,pixels:new Uint8Array(w*h).fill(255)},{widthMm:64,heightMm:64},settings),[]);
  const plan=generateStyledStrokes("test",map,{widthMm:64,heightMm:64},{name:"brush",shape:"round",widthMm:3},settings);
  const ordered=optimizeStrokeOrder(plan,createProject().workspace);
  const first=ordered.operations.findIndex(op=>op.type==="stroke"&&op.phase==="contours");
  assert.ok(first>0);assert.ok(ordered.operations.slice(first).every(op=>op.type==="stroke"&&op.phase==="contours"));
});
test("contour settings survive project save and reopen",()=>{
  const project={...createProject(),strokeSettings:settings};
  const parsed=parseProject(serializeProject(project));
  assert.equal(parsed.strokeSettings.direction,"image-contours");assert.equal(parsed.strokeSettings.contourSensitivity,.8);assert.equal(parsed.strokeSettings.contourGapMm,2);
});

test("image contour fill follows a vertical image edge instead of horizontal scan lines",()=>{
  const map={widthPx:w,heightPx:h,paintIds:["gold"],pixels:new Uint8Array(w*h),luminance:image(1)};
  const plan=generateStyledStrokes("vertical-edge",map,{widthMm:64,heightMm:64},{name:"brush",shape:"round",widthMm:3},{...settings,geometry:"curved",curvature:.6,joinNearbyStrokes:false});
  const fill=plan.operations.filter(op=>op.type==="stroke"&&!op.phase);
  assert.ok(fill.length>0);
  const vertical=fill.filter(op=>{if(op.type!=="stroke")return false;const a=op.points[0],b=op.points.at(-1)!;return Math.abs(b.y-a.y)>Math.abs(b.x-a.x)*2;});
  assert.ok(vertical.length/fill.length>.75,`${vertical.length}/${fill.length} fill strokes follow the vertical contour`);
});
