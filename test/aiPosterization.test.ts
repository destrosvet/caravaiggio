import assert from "node:assert/strict";
import test from "node:test";
import { AI_POSTERIZATION_VERSION, prepareAiPosterization, resizeImportance, validateAiPosterization } from "../src/core/aiPosterization.ts";
import { createProject, parseProject, serializeProject } from "../src/project/model.ts";
import { analyzeWithSam3, encodeRgba } from "../src/platform/sam3.ts";

test("detected details survive simplification, background speckles disappear and alpha stays intact", () => {
  const pixels = new Uint8ClampedArray(5 * 5 * 4);
  for (let i = 0; i < 25; i++) pixels[i * 4 + 3] = 255;
  pixels.set([255, 120, 60, 255], 12 * 4);
  pixels.set([70, 80, 90, 0], 0);
  const values = new Uint8Array(25); values[12] = 255;
  const mask = { width: 5, height: 5, values, subjects: 0, details: 1 };
  const protectedImage = prepareAiPosterization(pixels, 5, 5, { widthMm: 5, heightMm: 5 }, mask, { backgroundRadiusMm: 1, detailProtection: 1 });
  assert.deepEqual([...protectedImage.slice(48, 52)], [255, 120, 60, 255]);
  assert.deepEqual([...protectedImage.slice(0, 4)], [70, 80, 90, 0]);
  const simplified = prepareAiPosterization(pixels, 5, 5, { widthMm: 5, heightMm: 5 }, mask, { backgroundRadiusMm: 1, detailProtection: 0 });
  assert.deepEqual([...simplified.slice(48, 52)], [0, 0, 0, 255]);
  assert.equal(pixels[48], 255);
});

test("mask downsampling retains a one-pixel feature and rejects malformed dimensions", () => {
  const values = new Uint8Array(16); values[15] = 255;
  assert.deepEqual([...resizeImportance({ width: 4, height: 4, values, subjects: 0, details: 1 }, 2, 2)], [0, 0, 0, 255]);
  assert.throws(() => resizeImportance({ width: 2, height: 2, values, subjects: 0, details: 0 }, 2, 2));
  assert.throws(() => resizeImportance({ width: 4, height: 4, values, subjects: 0, details: 1 }, 0, 2));
});

test("classic remains the default and AI settings survive project save with validation", () => {
  const classic = createProject();
  assert.equal(classic.posterization.method ?? "classic", "classic");
  assert.equal(parseProject(serializeProject(classic)).posterization.method ?? "classic", "classic");
  const ai = { ...classic, posterization: { ...classic.posterization, method: "sam3" as const, ai: { backgroundRadiusMm: 4, detailProtection: .75 } } };
  assert.deepEqual(parseProject(serializeProject(ai)).posterization, ai.posterization);
  assert.throws(() => parseProject(JSON.stringify({ ...ai, posterization: { ...ai.posterization, method: "unknown" } })));
  assert.throws(() => validateAiPosterization({ backgroundRadiusMm: -1, detailProtection: 1 }));
});

test("local transport preserves bytes and refuses invalid or failed model responses", async context => {
  const originalFetch = globalThis.fetch; context.after(() => { globalThis.fetch = originalFetch; });
  const signal = new AbortController().signal;
  const pixels = new Uint8ClampedArray([0, 255, 128, 16]);
  assert.deepEqual([...Uint8Array.from(atob(encodeRgba(pixels)), c => c.charCodeAt(0))], [...pixels]);
  globalThis.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options?.body as string).rgba, encodeRgba(pixels));
    return new Response(JSON.stringify({ analysisVersion:AI_POSTERIZATION_VERSION,humanDetails:0,hairDetails:0,accessoryDetails:0,width: 1, height: 1, importance: btoa(String.fromCharCode(255)), subjects: 1, details: 0, recognition: btoa("\0"), faceMask: btoa("\0"), faces: 0, recognitionDetails: 0 }));
  };
  assert.equal((await analyzeWithSam3(pixels, 1, 1, signal)).values[0], 255);
  globalThis.fetch = async () => new Response(JSON.stringify({ analysisVersion:AI_POSTERIZATION_VERSION,humanDetails:0,hairDetails:0,accessoryDetails:0,width: 1, height: 1, importance: "", subjects: 0, details: 0 }));
  await assert.rejects(analyzeWithSam3(pixels, 1, 1, signal), /dimensions/);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Weights are missing" }), { status: 503 });
  await assert.rejects(analyzeWithSam3(pixels, 1, 1, signal), /Weights are missing/);
  globalThis.fetch = async () => { throw Error("Connection refused"); };
  await assert.rejects(analyzeWithSam3(pixels, 1, 1, signal), /not running/);
});

test("identity features keep their original contrast when generic detail protection is turned off", () => {
  const pixels = new Uint8ClampedArray(5 * 5 * 4);
  for (let i = 0; i < 25; i++) pixels.set([180, 180, 180, 255], i * 4);
  pixels.set([60, 60, 60, 255], 48);
  const values = new Uint8Array(25), recognition = new Uint8Array(25); values[12] = recognition[12] = 255;
  const result = prepareAiPosterization(pixels, 5, 5, { widthMm: 5, heightMm: 5 }, { width: 5, height: 5, values, recognition, subjects: 1, details: 1 }, { backgroundRadiusMm: 1, detailProtection: 0 });
  assert.ok(result[48] < pixels[48]); assert.equal(result[0], 180); assert.equal(result[51], 255);
});

test("facial recognition masks cross the service boundary with strict dimension checks", async context => {
  const originalFetch = globalThis.fetch; context.after(() => { globalThis.fetch = originalFetch; });
  const result = { analysisVersion:AI_POSTERIZATION_VERSION,humanDetails:0,hairDetails:0,accessoryDetails:0,width: 1, height: 1, importance: btoa(String.fromCharCode(255)), recognition: btoa(String.fromCharCode(255)), faceMask: btoa(String.fromCharCode(255)), subjects: 1, details: 2, faces: 1, recognitionDetails: 1 };
  globalThis.fetch = async () => new Response(JSON.stringify(result));
  const mask = await analyzeWithSam3(new Uint8ClampedArray(4), 1, 1, new AbortController().signal);
  assert.equal(mask.recognition?.[0], 255); assert.equal(mask.faces, 1);
  globalThis.fetch = async () => new Response(JSON.stringify({ ...result, recognition: "" }));
  await assert.rejects(analyzeWithSam3(new Uint8ClampedArray(4), 1, 1, new AbortController().signal), /recognition dimensions/);
});

test("additional face shade settings are optional, bounded and saved with automatic paint provenance", () => {
  const project = createProject();
  const ai = {...project, posterization: {...project.posterization, method: "sam3" as const, ai: {backgroundRadiusMm: 3, detailProtection: .9, faceShadeCount: 4}}, palette: project.palette.map((colour, index)=>index===0 ? {...colour,autoFaceShade:true} : colour)};
  assert.deepEqual(parseProject(serializeProject(ai)).posterization, ai.posterization);
  assert.equal(parseProject(serializeProject(ai)).palette[0].autoFaceShade, true);
  for(const count of [-1,9,.5,NaN]) assert.throws(()=>validateAiPosterization({...ai.posterization.ai,faceShadeCount:count}));
});

test("old service responses and malformed face masks require recovery instead of silently losing face shades", async context=>{
 const originalFetch=globalThis.fetch; context.after(()=>{globalThis.fetch=originalFetch;});
 const result={analysisVersion:AI_POSTERIZATION_VERSION,humanDetails:0,hairDetails:0,accessoryDetails:0,width:1,height:1,importance:btoa("\0"),recognition:btoa("\0"),subjects:0,details:0,faces:0,recognitionDetails:0};
 globalThis.fetch=async()=>new Response(JSON.stringify(result));
 await assert.rejects(analyzeWithSam3(new Uint8ClampedArray(4),1,1,new AbortController().signal),/Restart/);
 globalThis.fetch=async()=>new Response(JSON.stringify({...result,faceMask:""}));
 await assert.rejects(analyzeWithSam3(new Uint8ClampedArray(4),1,1,new AbortController().signal),/face mask dimensions/);
});

test("gap filling preference survives saving and rejects non-boolean values",()=>{
 const project=createProject(),ai={backgroundRadiusMm:3,detailProtection:.9,fillGaps:false};
 const saved=parseProject(serializeProject({...project,posterization:{...project.posterization,method:"sam3",ai}}));
 assert.deepEqual(saved.posterization.ai,ai);
 assert.throws(()=>validateAiPosterization({...ai,fillGaps:"yes"}));
});

test("new human detail counts are preserved and old cached analysis versions require a retry",async context=>{
 const original=globalThis.fetch;context.after(()=>{globalThis.fetch=original;});
 const result={analysisVersion:AI_POSTERIZATION_VERSION,width:1,height:1,importance:btoa("\0"),recognition:btoa("\0"),faceMask:btoa("\0"),subjects:1,details:3,faces:1,recognitionDetails:1,humanDetails:2,hairDetails:1,accessoryDetails:1};
 globalThis.fetch=async()=>new Response(JSON.stringify(result));
 const mask=await analyzeWithSam3(new Uint8ClampedArray(4),1,1,new AbortController().signal);
 assert.equal(mask.hairDetails,1);assert.equal(mask.accessoryDetails,1);
 globalThis.fetch=async()=>new Response(JSON.stringify({...result,analysisVersion:AI_POSTERIZATION_VERSION-1}));
 await assert.rejects(analyzeWithSam3(new Uint8ClampedArray(4),1,1,new AbortController().signal),/Restart/);
 globalThis.fetch=async()=>new Response(JSON.stringify({...result,hairDetails:-1}));
 await assert.rejects(analyzeWithSam3(new Uint8ClampedArray(4),1,1,new AbortController().signal),/detail counts/);
});
