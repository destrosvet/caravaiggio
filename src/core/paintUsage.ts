import type { SimulationTimeline } from "./simulation.ts";
export type PaintUsageSettings = Readonly<{ mlPerMetre: number; wastePerCleaningMl: number }>;
/** Illustrative starting coefficients, not measured material properties. */
export const defaultPaintUsageSettings: PaintUsageSettings = { mlPerMetre: .5, wastePerCleaningMl: .05 };
export function paintUsageIssues(settings: PaintUsageSettings): string[] {
  return !settings || !Number.isFinite(settings.mlPerMetre) || settings.mlPerMetre<=0 || !Number.isFinite(settings.wastePerCleaningMl) || settings.wastePerCleaningMl<0 ? ["Paint consumption needs positive finite ml per metre and non-negative finite cleaning waste."] : [];
}
export type PaintUsage = Readonly<{ paintId: string; distanceMm: number; loads: number; cleans: number; paintingMl: number; wasteMl: number; totalMl: number }>;
/** Count physical service sequences once, not each waypoint/repeat. Raised travel consumes no paint. */
export function estimatePaintUsage(timeline: SimulationTimeline, settings: PaintUsageSettings): PaintUsage[] {
  if(paintUsageIssues(settings).length) throw new Error("Invalid paint consumption calibration.");
  const byPaint=new Map<string, {paintId:string;distanceMm:number;loads:number;cleans:number}>();
  let previous: typeof timeline.events[number] | undefined;
  for(const event of timeline.events) {
    if(event.paintId && ["stroke","load","clean"].includes(event.type)) {
      let row=byPaint.get(event.paintId);
      if(!row) {row={paintId:event.paintId,distanceMm:0,loads:0,cleans:0};byPaint.set(event.paintId,row);}
      if(event.type==="stroke") row.distanceMm+=Math.hypot(event.to.x-event.from.x,event.to.y-event.from.y);
      if(event.type!==previous?.type || event.paintId!==previous?.paintId) {
        if(event.type==="load") row.loads++;
        if(event.type==="clean") row.cleans++;
      }
    }
    previous=event;
  }
  return [...byPaint.values()].map(row=>{const paintingMl=row.distanceMm/1000*settings.mlPerMetre,wasteMl=row.cleans*settings.wastePerCleaningMl;return {...row,paintingMl,wasteMl,totalMl:paintingMl+wasteMl};});
}
