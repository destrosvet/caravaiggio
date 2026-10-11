import type { PaintingPlan, Point, Stroke } from "./model.ts";
import type { BrushProfile, ColorRegionMap, StrokeGenerationSettings } from "./strokes.ts";
import { brushScaleMap } from "./brushScaleMap.ts";

/** Conservative physical footprints; this measures geometric coverage, not paint opacity. */
export function strokeCoverage(plan: PaintingPlan, map: ColorRegionMap, canvas: {widthMm:number;heightMm:number}, brush: BrushProfile): Uint8Array {
  const covered=new Uint8Array(map.pixels.length);
  for(const op of plan.operations) if(op.type==="stroke") reserve(covered,op,map,canvas,brush);
  return covered;
}
function reserve(covered: Uint8Array, stroke: Stroke, map: ColorRegionMap, canvas: {widthMm:number;heightMm:number}, brush: BrushProfile) {
  if(stroke.pressure<=0)return;
  const dx=canvas.widthMm/map.widthPx,dy=canvas.heightMm/map.heightPx;
  const radius=brush.widthMm*.5*(.65+.35*stroke.pressure)*.8;
  const rx=radius/dx,ry=radius/dy;
  for(let j=1;j<stroke.points.length;j++) {
    const a=stroke.points[j-1],b=stroke.points[j],length=Math.hypot(b.x-a.x,b.y-a.y);
    if(length<=0)continue;
    const n=Math.max(2,Math.ceil(length/(Math.min(dx,dy,radius)*.5)));
    for(let k=0;k<=n;k++) {
      const cx=(a.x+(b.x-a.x)*k/n)/dx,cy=(a.y+(b.y-a.y)*k/n)/dy;
      for(let y=Math.max(0,Math.floor(cy-ry));y<Math.min(map.heightPx,Math.ceil(cy+ry));y++)
        for(let x=Math.max(0,Math.floor(cx-rx));x<Math.min(map.widthPx,Math.ceil(cx+rx));x++)
          if(((x+.5-cx)/rx)**2+((y+.5-cy)/ry)**2<=1)covered[y*map.widthPx+x]=1;
    }
  }
}
/** Nearest artistic tangents, smoothed as undirected angles across stroke gaps. */
function fillDirectionField(plan: PaintingPlan, map: ColorRegionMap, canvas: {widthMm:number;heightMm:number}, settings: StrokeGenerationSettings): Float32Array {
  const w=map.widthPx,h=map.heightPx,dx=canvas.widthMm/w,dy=canvas.heightMm/h;
  const c=new Float32Array(w*h),s=new Float32Array(w*h),field=new Float32Array(w*h).fill(NaN),queue:number[]=[];
  for(const op of plan.operations)if(op.type==="stroke" && (!op.phase || op.phase==="contours")) {
    for(let j=1;j<op.points.length;j++) {
      const a=op.points[j-1],b=op.points[j],length=Math.hypot(b.x-a.x,b.y-a.y);
      if(!length)continue;
      const angle=Math.atan2(b.y-a.y,b.x-a.x),count=Math.max(1,Math.ceil(length/Math.min(dx,dy)));
      for(let k=0;k<=count;k++) {
        const x=Math.floor((a.x+(b.x-a.x)*k/count)/dx),y=Math.floor((a.y+(b.y-a.y)*k/count)/dy);
        if(x<0||y<0||x>=w||y>=h)continue;
        const i=y*w+x;c[i]+=Math.cos(2*angle);s[i]+=Math.sin(2*angle);
      }
    }
  }
  for(let i=0;i<field.length;i++)if(Math.hypot(c[i],s[i])>1e-6){field[i]=.5*Math.atan2(s[i],c[i]);queue.push(i);}
  for(let head=0;head<queue.length;head++) {
    const i=queue[head],x=i%w,y=Math.floor(i/w);
    for(const [ox,oy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const xx=x+ox,yy=y+oy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const n=yy*w+xx;if(Number.isNaN(field[n])){field[n]=field[i];queue.push(n);}
    }
  }
  const fallback=settings.direction==="vertical"?Math.PI/2:(settings.strategyParameters?.angle??0)*Math.PI/180;
  if(!queue.length)return field.fill(fallback);
  const smooth=new Float32Array(field.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let cc=0,ss=0;
    for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++){
      const angle=field[Math.max(0,Math.min(h-1,y+oy))*w+Math.max(0,Math.min(w-1,x+ox))];
      cc+=Math.cos(2*angle);ss+=Math.sin(2*angle);
    }
    smooth[y*w+x]=Math.hypot(cc,ss)>1e-6?.5*Math.atan2(ss,cc):field[y*w+x];
  }
  return smooth;
}

export function addCoverageFill(plan: PaintingPlan, map: ColorRegionMap, canvas: {widthMm:number;heightMm:number}, brush: BrushProfile, settings: StrokeGenerationSettings): PaintingPlan {
  if(!map.fillGaps || settings.pressure<=0 || settings.style==="pointillism" || settings.strategy==="dabs" || settings.strategy==="decorative-lines")return plan;
  const covered=strokeCoverage(plan,map,canvas,brush);
  const missing=()=>map.pixels.reduce((sum,paint,i)=>sum+(map.paintIds[paint]&&!covered[i]?1:0),0);
  const before=missing();
  if(!before)return {...plan,coverageStats:{strokes:0,uncoveredBefore:0,uncoveredAfter:0}};
  // The underpainting uses paintable brush-scale regions, rather than tracing every hair.
  const base=brushScaleMap({...map,recognitionMap:undefined},canvas,brush.widthMm*1.5);
  const dx=canvas.widthMm/map.widthPx,dy=canvas.heightMm/map.heightPx;
  const max=settings.maxStrokeLengthMm??settings.strokeLengthMm??75;
  const fills:Stroke[]=[];
  const field=fillDirectionField(plan,base,canvas,settings);
  const step=Math.min(dx,dy,brush.widthMm/3,max)*.5;
  const paintAt=(q:Point)=>{const x=Math.floor(q.x/dx),y=Math.floor(q.y/dy);return x>=0&&y>=0&&x<map.widthPx&&y<map.heightPx?base.pixels[y*map.widthPx+x]:255;};
  for(let y=0;y<map.heightPx;y++) for(let x=0;x<map.widthPx;x++) {
    const i=y*map.widthPx+x,paint=base.pixels[i];
    if(covered[i] || !map.paintIds[paint])continue;
    const start={x:(x+.5)*dx,y:(y+.5)*dy};
    const trace=(sign:number,limit:number)=>{
      const points:Point[]=[start];let q=start,angle=field[i]+(sign<0?Math.PI:0),length=0;
      for(let distance=step;distance<=limit+1e-9;distance+=step) {
        const index=Math.floor(q.y/dy)*map.widthPx+Math.floor(q.x/dx);
        let turn=field[index]-angle;turn=.5*Math.atan2(Math.sin(2*turn),Math.cos(2*turn));
        const turnLimit=(settings.strategyParameters?.turnLimit??.25)*step;
        angle+=Math.max(-turnLimit,Math.min(turnLimit,turn));
        const next={x:q.x+Math.cos(angle)*step,y:q.y+Math.sin(angle)*step};
        if(paintAt(next)!==paint)break;
        points.push(next);q=next;length+=step;
        const nextIndex=Math.floor(q.y/dy)*map.widthPx+Math.floor(q.x/dx);
        if(length>=brush.widthMm && covered[nextIndex])break;
      }
      return {points,length};
    };
    const backward=trace(-1,max/2),forward=trace(1,max-backward.length);
    let points=[...backward.points.reverse(),...forward.points.slice(1)],length=backward.length+forward.length;
    if(points.length<2){
      // An isolated sub-pixel island still needs a finite move in the local direction.
      const epsilon=Math.min(max,dx,dy)*.2,angle=field[i];
      points=[{x:start.x-Math.cos(angle)*epsilon/2,y:start.y-Math.sin(angle)*epsilon/2},{x:start.x+Math.cos(angle)*epsilon/2,y:start.y+Math.sin(angle)*epsilon/2}];length=epsilon;
    }
    const stroke:Stroke={type:"stroke",phase:"underpainting",paintId:map.paintIds[paint],points:[points[0],points[1],...points.slice(2)],pressure:settings.pressure,speedMmPerMin:settings.speedMmPerMin,expectedLoadStart:1,expectedLoadEnd:Math.max(0,1-length/(settings.paintLoadLengthMm??120))};
    fills.push(stroke);reserve(covered,stroke,map,canvas,brush);
  }
  return {...plan,operations:[...fills,...plan.operations],coverageStats:{strokes:fills.length,uncoveredBefore:before,uncoveredAfter:missing()}};
}
