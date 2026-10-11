import type { PaintingPlan } from "./model.ts";
export const strokeLengthBins = [1,2,5,10,20,50,100,Infinity] as const;
export const strokeLengthLabels = ["0–1","1–2","2–5","5–10","10–20","20–50","50–100","100+"] as const;
export type StrokeAnalyticsRow = {paintId:string;count:number;distanceMm:number;bins:number[]};
export function analyzeStrokes(plan:PaintingPlan,brushWidth:number) {
  const strokes=plan.operations.filter(op=>op.type==="stroke");
  const byPaint=new Map<string,StrokeAnalyticsRow>(),lengths:number[]=[];
  let shortCount=0,colourChanges=0,previous:string|undefined;
  for(const stroke of strokes) {
    let length=0;
    for(let i=1;i<stroke.points.length;i++) length+=Math.hypot(stroke.points[i].x-stroke.points[i-1].x,stroke.points[i].y-stroke.points[i-1].y);
    lengths.push(length);if(length<=brushWidth)shortCount++;
    if(previous!==undefined&&previous!==stroke.paintId)colourChanges++;
    previous=stroke.paintId;
    let row=byPaint.get(stroke.paintId);
    if(!row){row={paintId:stroke.paintId,count:0,distanceMm:0,bins:new Array(strokeLengthBins.length).fill(0)};byPaint.set(stroke.paintId,row);}
    row.count++;row.distanceMm+=length;row.bins[strokeLengthBins.findIndex(limit=>length<=limit)]++;
  }
  lengths.sort((a,b)=>a-b);
  const count=lengths.length,totalDistanceMm=[...byPaint.values()].reduce((sum,row)=>sum+row.distanceMm,0);
  const median=count ? count%2 ? lengths[count>>1] : (lengths[count/2-1]+lengths[count/2])/2 : 0;
  // Bounded stacked windows retain every stroke without creating thousands of SVG elements.
  const windowSize=Math.max(1,Math.ceil(count/120)),sequence:{start:number;end:number;counts:Map<string,number>}[]=[];
  for(let i=0;i<strokes.length;i++) {
    const index=Math.floor(i/windowSize);
    if(!sequence[index])sequence[index]={start:i+1,end:i+1,counts:new Map()};
    const window=sequence[index];window.end=i+1;window.counts.set(strokes[i].paintId,(window.counts.get(strokes[i].paintId)??0)+1);
  }
  return {count,totalDistanceMm,medianMm:median,averageMm:count?totalDistanceMm/count:0,shortCount,colourChanges,rows:[...byPaint.values()].sort((a,b)=>b.distanceMm-a.distanceMm),sequence};
}
