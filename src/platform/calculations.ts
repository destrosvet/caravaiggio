import { prepareAiPosterization,resizeImportance,defaultAiPosterizationSettings,type AiImportanceMask } from "../core/aiPosterization.ts";
import { medianFilterPixels } from "../core/medianFilter.ts";
import { nearestPaletteIndex } from "../core/color.ts";
import { detailPriorityMap,priorityDefaults } from "../core/priority.ts";
import { generateStyledStrokes,type ColorRegionMap } from "../core/strokes.ts";
import { buildMachineProgram,type MachineProgram } from "../core/machineProgram.ts";
import { renderPaintTimeline,paintPreviewLongestEdge,paintSimulationDefaults } from "../core/paintRaster.ts";
import { strokePreviewTimeline } from "../core/strokePreview.ts";
import type { PaintingPlan } from "../core/model.ts";
import type { Workspace } from "../core/workspace.ts";
import type { CaravaiggioProject } from "../project/model.ts";
export type CalculationProject=Pick<CaravaiggioProject,"id"|"canvas"|"brush"|"palette"|"posterization"|"strokeSettings"|"workspace">;
export type CalculationRequest =
 | {kind:"strokes";project:CalculationProject;pixels:Uint8ClampedArray;width:number;height:number;mask?:AiImportanceMask;seed:string}
 | {kind:"paths";plan:PaintingPlan;workspace:Workspace;capacity:number;brushWidth:number;regionMap?:ColorRegionMap}
 | {kind:"preview";plan:PaintingPlan;project:CalculationProject};
export type CalculationResults={strokes:{plan:PaintingPlan;regionMap:ColorRegionMap;priority:Float32Array};paths:MachineProgram;preview:{width:number;height:number;rgba:Uint8ClampedArray}};
export function executeCalculation(request:CalculationRequest,progress:(stage:string)=>void):CalculationResults[keyof CalculationResults] {
 if(request.kind==="paths"){
  progress("Optimizing strokes and calculating XYZ paths…");
  const result=buildMachineProgram(request.plan,request.workspace,request.capacity,request.brushWidth,request.regionMap);
  progress("Finalizing machine paths…");return result;
 }
 const project=request.project;
 if(request.kind==="preview"){
  progress("Preparing paint preview…");
  const {timeline,origin}=strokePreviewTimeline(request.plan,project.canvas,project.palette,project.workspace,project.strokeSettings.paintLoadLengthMm??120,project.brush.widthMm);
  const aspect=project.canvas.widthMm/project.canvas.heightMm;
  const width=aspect>=1?paintPreviewLongestEdge:Math.max(1,Math.round(paintPreviewLongestEdge*aspect)),height=Math.max(1,Math.round(width/aspect));
  progress("Rendering paint and brush texture…");
  const raster=renderPaintTimeline(timeline,project.canvas,project.brush,project.palette,width,height,project.strokeSettings.paintSimulation??paintSimulationDefaults,project.palette.find(p=>p.skipPainting)?.hex??"#eee8da",origin);
  return {width,height,rgba:raster.rgba};
 }
 const {pixels,width,height,mask}=request,ai=project.posterization.method==="sam3";
 if(ai&&!mask)throw Error("Waiting for local SAM 3 analysis.");
 progress("Preparing colours and image details…");
 const colours=ai?prepareAiPosterization(pixels,width,height,project.canvas,mask!,project.posterization.ai??defaultAiPosterizationSettings):medianFilterPixels(pixels,width,height,project.canvas,project.posterization.medianRadiusMm);
 const colorMap=new Uint8Array(width*height),luminance=new Float32Array(colorMap.length);
 progress("Mapping pixels to paints…");
 for(let i=0;i<colorMap.length;i++){
  const offset=i*4;luminance[i]=(.2126*pixels[offset]+.7152*pixels[offset+1]+.0722*pixels[offset+2])/255;
  if(pixels[offset+3]<16){colorMap[i]=255;continue;}
  colorMap[i]=nearestPaletteIndex({r:colours[offset],g:colours[offset+1],b:colours[offset+2]},project.palette);
  if(project.palette[colorMap[i]]?.skipPainting)colorMap[i]=255;
 }
 const regionMap:ColorRegionMap={widthPx:width,heightPx:height,paintIds:project.palette.map(p=>p.id),pixels:colorMap};
 progress("Finding important details…");
 const priority=detailPriorityMap({...regionMap,luminance},project.canvas,project.brush,project.strokeSettings.strategy==="flow-curves"?project.strokeSettings.priority??priorityDefaults:priorityDefaults);
 if(ai&&mask){const semantic=resizeImportance(mask,width,height);for(let i=0;i<priority.length;i++)priority[i]=Math.max(priority[i],semantic[i]/255);}
 progress("Generating strokes, gap fills and face details…");
 const plan=generateStyledStrokes(project.id,{...regionMap,luminance,palette:project.palette,sourceRgba:pixels,priorityMap:priority,fillGaps:ai&&(project.posterization.ai?.fillGaps??true),recognitionMap:ai&&mask?.recognition?resizeImportance({...mask,values:mask.recognition},width,height):undefined},project.canvas,project.brush,{...project.strokeSettings,seed:project.strokeSettings.seed.trim()||request.seed});
 return {plan,regionMap,priority};
}
