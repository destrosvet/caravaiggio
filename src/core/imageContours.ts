import type { Point, Stroke } from "./model.ts";
import type { ColorRegionMap, StrokeGenerationSettings } from "./strokes.ts";

/** Gaussian smoothing, Sobel gradients, non-maximum suppression and hysteresis. */
export function cannyEdges(values: Float32Array, width: number, height: number, smoothing = 0.5, sensitivity = 0.5): Uint8Array {
  const sigma = 0.6 + smoothing * 2.4, radius = Math.ceil(sigma * 3);
  const kernel = Array.from({length: radius * 2 + 1}, (_, i) => Math.exp(-((i-radius)**2)/(2*sigma*sigma)));
  const sum = kernel.reduce((a,b)=>a+b,0); kernel.forEach((_,i)=>kernel[i]/=sum);
  const tmp = new Float32Array(values.length), blurred = new Float32Array(values.length);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) for(let k=-radius;k<=radius;k++) tmp[y*width+x]+=values[y*width+Math.max(0,Math.min(width-1,x+k))]*kernel[k+radius];
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) for(let k=-radius;k<=radius;k++) blurred[y*width+x]+=tmp[Math.max(0,Math.min(height-1,y+k))*width+x]*kernel[k+radius];
  const magnitude=new Float32Array(values.length), angles=new Uint8Array(values.length);
  for(let y=1;y<height-1;y++) for(let x=1;x<width-1;x++) {
    const i=y*width+x, a=(dx:number,dy:number)=>blurred[i+dy*width+dx];
    const gx=-a(-1,-1)+a(1,-1)-2*a(-1,0)+2*a(1,0)-a(-1,1)+a(1,1);
    const gy=-a(-1,-1)-2*a(0,-1)-a(1,-1)+a(-1,1)+2*a(0,1)+a(1,1);
    magnitude[i]=Math.hypot(gx,gy); angles[i]=Math.round((Math.atan2(gy,gx)+Math.PI)*4/Math.PI)%4;
  }
  const thin=new Float32Array(values.length), offsets=[1,width+1,width,width-1];
  for(let y=1;y<height-1;y++) for(let x=1;x<width-1;x++) {
    const i=y*width+x,o=offsets[angles[i]];
    if(magnitude[i]>0 && magnitude[i]>=magnitude[i-o] && magnitude[i]>=magnitude[i+o]) thin[i]=magnitude[i];
  }
  const high=0.04+(1-sensitivity)*0.65, low=high*0.4, edges=new Uint8Array(values.length), queue:number[]=[];
  for(let i=0;i<thin.length;i++) if(thin[i]>=high) {edges[i]=1;queue.push(i);}
  for(let head=0;head<queue.length;head++) {
    const i=queue[head],x=i%width,y=Math.floor(i/width);
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      if(x+dx<1||x+dx>=width-1||y+dy<1||y+dy>=height-1) continue;
      const n=i+dy*width+dx;if(!edges[n]&&thin[n]>=low){edges[n]=1;queue.push(n);}
    }
  }
  return edges;
}

export function imageContourStrokes(map: ColorRegionMap, canvas: {widthMm:number;heightMm:number}, settings: StrokeGenerationSettings): Stroke[] {
  if(!map.luminance) return [];
  const w=map.widthPx,h=map.heightPx,edges=cannyEdges(map.luminance,w,h,settings.contourSmoothing??0.5,settings.contourSensitivity??0.5);
  const seen=new Uint8Array(edges.length), paths: {points:Point[];paint:number}[]=[];
  const neighbours=(i:number)=>{
    const result:number[]=[];for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      const x=i%w+dx,y=Math.floor(i/w)+dy,n=y*w+x;
      if((dx||dy)&&x>=0&&x<w&&y>=0&&y<h&&edges[n]&&!seen[n]&&map.pixels[n]===map.pixels[i])result.push(n);
    }return result;
  };
  const seeds=Array.from(edges.keys()).filter(i=>edges[i]&&map.paintIds[map.pixels[i]]);
  seeds.sort((a,b)=>neighbours(a).length-neighbours(b).length);
  for(const seed of seeds) {
    if(seen[seed])continue;const points:Point[]=[];let current=seed;
    while(true){seen[current]=1;points.push({x:(current%w+.5)/w*canvas.widthMm,y:(Math.floor(current/w)+.5)/h*canvas.heightMm});const next=neighbours(current);if(!next.length)break;current=next[0];}
    if(points.length>1)paths.push({points,paint:map.pixels[seed]});
  }
  const gap=settings.contourGapMm??2;
  // Spatial buckets bound endpoint searches instead of scanning every contour pair.
  if(gap>0){
    const key=(p:Point)=>`${Math.floor(p.x/gap)},${Math.floor(p.y/gap)}`;
    const buckets=new Map<string,number[]>();
    paths.forEach((path,i)=>{for(const p of [path.points[0],path.points.at(-1)!]){const k=key(p),v=buckets.get(k)??[];v.push(i);buckets.set(k,v);}});
    const consumed=new Set<number>();
    for(let i=0;i<paths.length;i++){
      if(consumed.has(i))continue;const path=paths[i];
      for(let attempt=0;attempt<paths.length;attempt++){
        const end=path.points.at(-1)!,bx=Math.floor(end.x/gap),by=Math.floor(end.y/gap);let best=-1,reverse=false,distance=gap;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const j of buckets.get(`${bx+dx},${by+dy}`)??[]){
          if(j===i||consumed.has(j)||paths[j].paint!==path.paint)continue;
          for(const reversed of [false,true]){const p=reversed?paths[j].points.at(-1)!:paths[j].points[0],d=Math.hypot(end.x-p.x,end.y-p.y);
            if(d>distance)continue;
            let valid=true;const steps=Math.max(1,Math.ceil(d/Math.min(canvas.widthMm/w,canvas.heightMm/h)));
            for(let s=0;s<=steps;s++){const x=Math.min(w-1,Math.floor((end.x+(p.x-end.x)*s/steps)/canvas.widthMm*w)),y=Math.min(h-1,Math.floor((end.y+(p.y-end.y)*s/steps)/canvas.heightMm*h));if(map.pixels[y*w+x]!==path.paint){valid=false;break;}}
            if(valid){best=j;reverse=reversed;distance=d;}
          }
        }
        if(best<0)break;consumed.add(best);path.points.push(...(reverse?[...paths[best].points].reverse():paths[best].points));
      }
    }
    for(const i of [...consumed].sort((a,b)=>b-a))paths.splice(i,1);
  }
  const strokes:Stroke[]=[],max=settings.maxStrokeLengthMm??settings.strokeLengthMm??75,min=settings.minStrokeLengthMm??1;
  for(const path of paths){
    // Smooth corners while retaining the original material region.
    const points=path.points.map((p,i)=>{
      if(i===0||i===path.points.length-1)return p;
      const a=path.points[i-1],b=path.points[i+1],q={x:(a.x+2*p.x+b.x)/4,y:(a.y+2*p.y+b.y)/4};
      const x=Math.floor(q.x/canvas.widthMm*w),y=Math.floor(q.y/canvas.heightMm*h);return map.pixels[y*w+x]===path.paint?q:p;
    });
    let chunk:Point[]=[points[0]],length=0;
    const emit=()=>{if(length+1e-6>=min&&chunk.length>1)strokes.push({type:"stroke",phase:"contours",paintId:map.paintIds[path.paint],points:chunk as [Point,Point,...Point[]],pressure:settings.pressure,speedMmPerMin:settings.speedMmPerMin,expectedLoadStart:1,expectedLoadEnd:.9});};
    for(let i=1;i<points.length;i++){
      let from=chunk.at(-1)!,to=points[i],segment=Math.hypot(to.x-from.x,to.y-from.y);
      while(length+segment>max){const t=(max-length)/segment,end={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t};chunk.push(end);length=max;emit();chunk=[end];length=0;from=end;segment=Math.hypot(to.x-from.x,to.y-from.y);}
      chunk.push(to);length+=segment;
    }emit();
  }
  return strokes;
}

/** Propagate contour tangents into the interior so fill strokes follow image structure. */
export function contourDirectionField(map: ColorRegionMap, settings: StrokeGenerationSettings): Float32Array | undefined {
  if (!map.luminance) return;
  const w=map.widthPx,h=map.heightPx,edges=cannyEdges(map.luminance,w,h,settings.contourSmoothing??.5,settings.contourSensitivity??.5);
  const field=new Float32Array(w*h).fill(NaN),queue:number[]=[];
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;if(!edges[i]||!map.paintIds[map.pixels[i]])continue;
    let xx=0,xy=0,yy=0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      const px=x+dx,py=y+dy;if(px<0||px>=w||py<0||py>=h||!edges[py*w+px])continue;
      xx+=dx*dx;xy+=dx*dy;yy+=dy*dy;
    }
    field[i]=.5*Math.atan2(2*xy,xx-yy);queue.push(i);
  }
  if(!queue.length)return;
  for(let head=0;head<queue.length;head++){
    const i=queue[head],x=i%w,y=Math.floor(i/w);
    for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
      const px=x+dx,py=y+dy;if(px<0||px>=w||py<0||py>=h)continue;
      const n=py*w+px;if(Number.isNaN(field[n])){field[n]=field[i];queue.push(n);}
    }
  }
  const smooth=new Float32Array(field.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let c=0,s=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
      const px=Math.max(0,Math.min(w-1,x+dx)),py=Math.max(0,Math.min(h-1,y+dy)),a=field[py*w+px];c+=Math.cos(2*a);s+=Math.sin(2*a);
    }smooth[y*w+x]=.5*Math.atan2(s,c);
  }
  return smooth;
}
