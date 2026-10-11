import assert from "node:assert/strict";
import test from "node:test";
import { facePalette } from "../src/core/facePalette.ts";
import { createProject, type PaletteColor } from "../src/project/model.ts";
const base: PaletteColor = {...createProject().palette[0],hex:"#FFFFFF",id:"base"};
const pixels = new Uint8ClampedArray([230,170,120,255,130,70,40,255,20,190,230,255,240,20,220,0]);
const mask = {width:4,height:1,values:new Uint8Array(4),faceMask:new Uint8Array([255,255,0,255]),subjects:1,details:1};
test("extra paints come only from visible detected faces and improve two missing shade matches",()=>{
  const result = facePalette(pixels,4,1,mask,[base],2);
  assert.deepEqual(result.map(c=>c.hex),["#FFFFFF","#E6AA78","#824628"]);
  assert.ok(result.slice(1).every(c=>c.autoFaceShade && !c.locked && !c.skipPainting));
  assert.deepEqual(facePalette(pixels,4,1,mask,result,2), result);
  assert.deepEqual(facePalette(pixels,4,1,mask,result,0), [base]);
});
test("locked shades stay unchanged and count toward the requested number",()=>{
  const shades = facePalette(pixels,4,1,mask,[base],2);
  const locked = {...shades[1], locked:true, hex:"#E0A070" as const};
  const result = facePalette(pixels,4,1,mask,[base,locked,shades[2]],2);
  assert.equal(result.length,3); assert.deepEqual(result[1],locked);
  assert.deepEqual(facePalette(pixels,4,1,mask,result,0),[base,locked]);
});
test("no faces adds no paints, transparent face pixels are excluded and capacity is respected",()=>{
  assert.deepEqual(facePalette(pixels,4,1,{...mask,faceMask:new Uint8Array(4)},[base],4),[base]);
  assert.deepEqual(facePalette(pixels,4,1,undefined,[base],4),[base]);
  const full = Array.from({length:255},(_,i)=>({...base,id:String(i)}));
  assert.equal(facePalette(pixels,4,1,mask,full,8).length,255);
  assert.throws(()=>facePalette(pixels,4,1,mask,[base],9));
});

test("automatic refresh preserves the canvas flag and palette matching rules",()=>{
 const palette=facePalette(pixels,4,1,mask,[base],2);
 const changed=palette.map((colour,index)=>index===1 ? {...colour,skipPainting:true,restricted:true,hueToleranceDeg:15,minimumChroma:.02} : colour);
 assert.deepEqual(facePalette(pixels,4,1,mask,changed,2),changed);
});
