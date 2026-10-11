import type { MotionDynamics, AxisValues } from "./machineSettings.ts";
export type VelocityProfile = Readonly<{ distance: number; entry: number; exit: number; peak: number; acceleration: number; accelerateSeconds: number; cruiseSeconds: number; decelerateSeconds: number }>;
type XYZ = Readonly<{x:number;y:number;z:number}>;
type Motion = Readonly<{from:XYZ;to:XYZ;speed:number;seconds:number}>;
const axes = ["x","y","z"] as const;
const norm = (v: XYZ) => Math.hypot(v.x,v.y,v.z);
const directionalLimit = (limits: AxisValues, direction: XYZ) => Math.min(...axes.map(axis=>Math.abs(direction[axis])>1e-12 ? limits[axis]/Math.abs(direction[axis]) : Infinity));
/** Trapezoidal/triangular velocity with zero speed at program ends and dwells.
 * Whole-path lookahead approximates a continuously fed Cartesian FluidNC controller.
 * It does not model finite controller buffer, step quantisation or streaming starvation.
 */
export function calculateMotionDynamics(motions: readonly Motion[], settings: MotionDynamics): {speed:number;seconds:number;profile?:VelocityProfile}[] {
  const blocks = motions.map(m=>{
    const delta={x:m.to.x-m.from.x,y:m.to.y-m.from.y,z:m.to.z-m.from.z}, distance=norm(delta);
    const direction=distance ? {x:delta.x/distance,y:delta.y/distance,z:delta.z/distance} : {x:0,y:0,z:0};
    return {distance,direction,velocity:Math.min(m.speed,directionalLimit(settings.maxRate,direction))/60,acceleration:directionalLimit(settings.acceleration,direction)};
  });
  const results=motions.map(m=>({speed:m.speed,seconds:m.seconds,profile:undefined as VelocityProfile|undefined}));
  let group:number[]=[];
  const flush=()=>{
    if(!group.length) return;
    const speeds=new Array<number>(group.length+1).fill(0);
    for(let j=1;j<group.length;j++) {
      const a=blocks[group[j-1]], b=blocks[group[j]];
      const dot=Math.max(-1,Math.min(1,axes.reduce((sum,axis)=>sum+a.direction[axis]*b.direction[axis],0)));
      let corner=0;
      if(dot>1-1e-10) corner=Infinity;
      else if(dot>-1+1e-10) {
        const change={x:b.direction.x-a.direction.x,y:b.direction.y-a.direction.y,z:b.direction.z-a.direction.z}, size=norm(change);
        const direction={x:change.x/size,y:change.y/size,z:change.z/size};
        const acceleration=directionalLimit(settings.acceleration,direction), half=Math.sqrt((1+dot)/2);
        corner=Math.sqrt(acceleration*settings.junctionDeviation*half/(1-half));
      }
      speeds[j]=Math.min(a.velocity,b.velocity,corner);
    }
    for(let j=group.length-1;j>=0;j--) {const b=blocks[group[j]];speeds[j]=Math.min(speeds[j],Math.sqrt(speeds[j+1]**2+2*b.acceleration*b.distance));}
    for(let j=0;j<group.length;j++) {const b=blocks[group[j]];speeds[j+1]=Math.min(speeds[j+1],Math.sqrt(speeds[j]**2+2*b.acceleration*b.distance));}
    for(let j=0;j<group.length;j++) {
      const i=group[j], b=blocks[i], entry=speeds[j],exit=speeds[j+1],acceleration=b.acceleration;
      const peak=Math.min(b.velocity,Math.sqrt(acceleration*b.distance+(entry**2+exit**2)/2));
      const accelerateSeconds=Math.max(0,(peak-entry)/acceleration),decelerateSeconds=Math.max(0,(peak-exit)/acceleration);
      const accelerateDistance=(entry+peak)*accelerateSeconds/2,decelerateDistance=(exit+peak)*decelerateSeconds/2;
      const cruiseSeconds=Math.max(0,b.distance-accelerateDistance-decelerateDistance)/peak;
      results[i]={speed:b.velocity*60,seconds:accelerateSeconds+cruiseSeconds+decelerateSeconds,profile:{distance:b.distance,entry,exit,peak,acceleration,accelerateSeconds,cruiseSeconds,decelerateSeconds}};
    }
    group=[];
  };
  for(let i=0;i<motions.length;i++) {
    if(blocks[i].distance>0) group.push(i);
    else if(motions[i].seconds>0) flush(); // G4 forces a complete stop; zero-length markers do not.
  }
  flush();return results;
}
export function profileProgress(profile: VelocityProfile, seconds: number): number {
  const {entry,peak,acceleration,accelerateSeconds,cruiseSeconds,decelerateSeconds,distance}=profile;
  const t=Math.max(0,Math.min(seconds,accelerateSeconds+cruiseSeconds+decelerateSeconds));
  if(t<=accelerateSeconds) return (entry*t+acceleration*t*t/2)/distance;
  const ramp=(entry+peak)*accelerateSeconds/2;
  if(t<=accelerateSeconds+cruiseSeconds) return (ramp+peak*(t-accelerateSeconds))/distance;
  const decel=t-accelerateSeconds-cruiseSeconds;
  return Math.max(0,Math.min(1,(ramp+peak*cruiseSeconds+peak*decel-acceleration*decel*decel/2)/distance));
}
