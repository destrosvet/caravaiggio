import { calculateMotionDynamics } from "./motionDynamics.ts";
import type { MotionDynamics } from "./machineSettings.ts";
import { joinMachineStrokes } from "./machineStrokeJoining.ts";
import type { ColorRegionMap } from "./strokes.ts";
import type { PaintingPlan, Point } from "./model.ts";
import { buildSimulation, segmentIntersectsZone, type SimulationEvent, type SimulationTimeline } from "./simulation.ts";
import { optimizeStrokeOrder } from "./strokeOrdering.ts";
import { validateWorkspace, type Workspace, type WorkspaceZone } from "./workspace.ts";
import { defaultMachineSettings, defaultProcedure, procedureIssues } from "./machineSettings.ts";
export type Position3D = Readonly<Point & { z: number }>;
export type MachineMotion = Readonly<{ type: SimulationEvent["type"]; from: Position3D; to: Position3D; speed: number; seconds: number; paintId?: string }>;
export type MachineProgram = Readonly<{ motions: readonly MachineMotion[]; timeline: SimulationTimeline; issues: readonly string[]; clearanceZ: number; dynamics?: MotionDynamics; optimization?: Readonly<{ originalStrokes: number; connectedStrokes: number; joins: number; addedPaintingMm: number; beforeSeconds: number; savedSeconds: number; rejected: boolean }> }>;
export type MachinePlanSnapshot = Readonly<{ sourcePlan: PaintingPlan; workspaceSignature: string; capacity: number; brushWidth: number; program: MachineProgram }>;
const length = (a: Position3D, b: Position3D) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);
const centre = (zone: WorkspaceZone): Point => ({ x: zone.x + zone.width/2, y: zone.y + zone.height/2 });
/** Visibility graph around rectangular keep-out zones, including brush clearance. */
export function routeTravel(from: Point, to: Point, workspace: Workspace, margin: number): Point[] | null {
  const obstacles = workspace.zones.filter(zone => zone.type === "forbidden");
  const clear = (a: Point, b: Point) => !obstacles.some(zone => segmentIntersectsZone(a,b,zone,margin));
  if (clear(from,to)) return [to];
  const pad = margin + .02;
  const points: Point[] = [from,to];
  for (const zone of obstacles) for (const x of [zone.x-pad,zone.x+zone.width+pad]) for (const y of [zone.y-pad,zone.y+zone.height+pad]) {
    const point = {x,y};
    if (x >= margin && y >= margin && x <= workspace.width-margin && y <= workspace.height-margin && clear(point,point)) points.push(point);
  }
  const scores = points.map(()=>Infinity), previous = points.map(()=>-1), visited = new Set<number>(); scores[0]=0;
  for (let step=0;step<points.length;step++) {
    let current=-1;
    for (let i=0;i<points.length;i++) if (!visited.has(i) && (current<0 || scores[i]<scores[current])) current=i;
    if (current<0 || !Number.isFinite(scores[current])) return null;
    if (current===1) break;
    visited.add(current);
    for (let i=0;i<points.length;i++) if (!visited.has(i) && clear(points[current],points[i])) {
      const score=scores[current]+Math.hypot(points[current].x-points[i].x,points[current].y-points[i].y);
      if(score<scores[i]) {scores[i]=score;previous[i]=current;}
    }
  }
  if(previous[1]<0) return null;
  const path: Point[]=[]; for(let i=1;i!==0;i=previous[i]) path.unshift(points[i]); return path;
}
/** The same explicit XYZ motions drive playback and GRBL export. Stroke geometry is unchanged. */
export function buildMachineProgram(plan: PaintingPlan, workspace: Workspace, capacity: number, brushWidth: number, regionMap?: ColorRegionMap): MachineProgram {
  const settings=workspace.machine ?? defaultMachineSettings;
  const issues=[...validateWorkspace(workspace)];
  const serviceZones=workspace.zones.filter(zone => ["paint","water","wipe"].includes(zone.type));
  const clearanceZ=Math.max(workspace.safeZ,settings.canvasTravelZ ?? workspace.safeZ,...serviceZones.map(zone => (zone.procedure ?? defaultProcedure(zone.type,workspace.safeZ)).clearanceZ));
  if (!Number.isFinite(brushWidth) || brushWidth<=0) issues.push("Brush width must be positive.");
  if (clearanceZ>settings.zMax) issues.push("Container clearance exceeds machine Z limits.");
  if (plan.operations.some(op=>op.type!=="stroke")) issues.push("Machine planning requires a generated stroke-only plan.");
  const canvas=workspace.zones.find(zone=>zone.type==="canvas");
  for(const op of plan.operations) if(op.type==="stroke") {
    if(op.points.length<2 || op.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||!canvas||p.x<0||p.y<0||p.x>canvas.width||p.y>canvas.height)) issues.push("A painting stroke is outside the canvas or has invalid points.");
    if(!Number.isFinite(op.pressure)||op.pressure<0||op.pressure>1) issues.push("Stroke pressure must be between zero and one.");
    if(!Number.isFinite(op.speedMmPerMin)||op.speedMmPerMin<=0) issues.push("Stroke speed must be positive.");
  }
  for(const zone of serviceZones) {
    const procedure=zone.procedure ?? defaultProcedure(zone.type,workspace.safeZ);
    issues.push(...procedureIssues(procedure).map(message=>zone.name+": "+message));
    for(const point of procedure.steps) {
      if(Math.abs(point.x)+brushWidth/2>zone.width/2 || Math.abs(point.y)+brushWidth/2>zone.height/2) issues.push(zone.name+": service movement does not fit inside the zone with brush clearance.");
      if(point.z<settings.zMin||point.z>settings.zMax) issues.push(zone.name+": service Z is outside machine limits.");
    }
  }
  if (issues.length) {
    const unique=[...new Set(issues)];
    return {motions:[],clearanceZ,issues:unique,timeline:{events:[],duration:0,paintDistance:0,travelDistance:0,strokes:0,loads:0,cleans:0,issues:unique}};
  }
  const ordered=settings.optimizeOrder ? optimizeStrokeOrder(plan,workspace) : plan;
  const joining=settings.joinStrokes && regionMap && canvas ? joinMachineStrokes(ordered,regionMap,{widthMm:canvas.width,heightMm:canvas.height},brushWidth,settings.joinGapMm ?? brushWidth*.75) : {plan:ordered,joins:0,addedDistance:0};
  const baseline=joining.joins ? buildMachineProgram(plan,{...workspace,machine:{...settings,joinStrokes:false}},capacity,brushWidth) : null;
  // Travel obstacles are routed below; all other workspace errors remain blocking.
  const base=buildSimulation(joining.plan,{...workspace,zones:workspace.zones.filter(zone=>zone.type!=="forbidden")},capacity,brushWidth);
  issues.push(...base.issues);
  const sourceEvents=[...base.events];
  if(settings.cleanBeforeStart && base.strokes && !base.issues.length) {
    const first=sourceEvents[0],prefix: SimulationEvent[]=[];
    let point=first.from;
    for(const type of ["clean","wipe"] as const) {
      const zone=workspace.zones.find(zone=>zone.type===(type==="clean"?"water":"wipe"))!;
      const to=centre(zone);
      prefix.push({type:"move",from:point,to,start:0,end:0,loadStart:0,loadEnd:0});
      prefix.push({type,from:to,to,start:0,end:0,loadStart:0,loadEnd:0});point=to;
    }
    sourceEvents.unshift(...prefix);
  }
  const motions: MachineMotion[]=[],events: SimulationEvent[]=[];
  const parking=workspace.zones.find(zone=>zone.type==="parking");
  let position: Position3D={...(parking?centre(parking):{x:0,y:0}),z:clearanceZ},elapsed=0,travelDistance=0,load=0;
  const add=(type: SimulationEvent["type"],to: Position3D,speed: number,dwell=0,event?: SimulationEvent,loadEnd=load)=>{
    const distance=length(position,to),seconds=distance/speed*60+dwell;
    motions.push({type,from:position,to,speed,seconds,paintId:event?.paintId});
    events.push({type,from:position,to,start:elapsed,end:elapsed+seconds,paintId:event?.paintId,pressure:event?.pressure,loadStart:load,loadEnd});
    if(type==="move") travelDistance+=distance;
    elapsed+=seconds;position=to;load=loadEnd;
  };
  const lift=(z=clearanceZ)=>{if(position.z!==z) add("move",{...position,z},settings.verticalSpeed);};
  if(!issues.length) for(const event of sourceEvents) {
    if(event.type==="move") {
      const route=routeTravel(position,event.to,workspace,brushWidth/2);
      if(!route){issues.push("No safe travel route to X"+event.to.x+" Y"+event.to.y+". Change the workspace layout.");break;}
      const insideCanvas=(point: Point)=>!!canvas && point.x>=canvas.x && point.x<=canvas.x+canvas.width && point.y>=canvas.y && point.y<=canvas.y+canvas.height;
      const travelZ=insideCanvas(position)&&route.every(insideCanvas) ? settings.canvasTravelZ ?? workspace.safeZ : clearanceZ;
      lift(travelZ);
      for(const point of route) add("move",{...point,z:travelZ},settings.travelSpeed,0,event);
    } else if(event.type==="stroke") {
      const z=settings.paintZMax-(event.pressure ?? 0)*(settings.paintZMax-settings.paintZMin);
      if(position.z!==z) add("move",{...position,z},settings.verticalSpeed,0,event);
      add("stroke",{...event.to,z},Math.hypot(event.to.x-event.from.x,event.to.y-event.from.y)/(event.end-event.start)*60,0,event,event.loadEnd);
    } else if(event.type==="load"||event.type==="clean"||event.type==="wipe") {
      const zone=workspace.zones.find(zone=>event.type==="load" ? zone.type==="paint"&&zone.paintId===event.paintId : zone.type===(event.type==="clean"?"water":"wipe"))!;
      const procedure=zone.procedure ?? defaultProcedure(zone.type,workspace.safeZ), origin=centre(zone);
      lift();
      const first=procedure.steps[0];
      add("move",{x:origin.x+first.x,y:origin.y+first.y,z:clearanceZ},settings.travelSpeed,0,event);
      for(let repeat=0;repeat<procedure.repeats;repeat++) for(const point of procedure.steps) {
        add(event.type,{x:origin.x+point.x,y:origin.y+point.y,z:point.z},procedure.speed,0,event);
        if(point.seconds) add(event.type,position,procedure.speed,point.seconds,event);
      }
      load=event.loadEnd; // The completed procedure loads or clears the brush once.
      if(events.length) events[events.length-1]={...events[events.length-1],loadEnd:load};
      lift();
    } else if(event.type==="park") {lift();add("park",position,settings.travelSpeed,0,event);}
  }
  const obstacles=workspace.zones.filter(zone=>zone.type==="forbidden");
  for(const motion of motions) {
    if([motion.to.x,motion.to.y,motion.to.z,motion.speed,motion.seconds].some(v=>!Number.isFinite(v))||motion.speed<=0||motion.seconds<0) issues.push("Invalid machine motion.");
    if(motion.to.x<0||motion.to.y<0||motion.to.x>workspace.width||motion.to.y>workspace.height||motion.to.z<settings.zMin||motion.to.z>settings.zMax) issues.push("Machine motion exceeds XYZ limits.");
    for(const zone of obstacles) if(segmentIntersectsZone(motion.from,motion.to,zone,brushWidth/2)) issues.push("Machine path intersects forbidden zone "+zone.name+".");
  }
  const unique=[...new Set(issues)];
  if (settings.dynamics?.enabled && !unique.length) {
    const timing=calculateMotionDynamics(motions,settings.dynamics);
    elapsed=0;
    for(let i=0;i<motions.length;i++) {
      motions[i]={...motions[i],speed:timing[i].speed,seconds:timing[i].seconds};
      events[i]={...events[i],start:elapsed,end:elapsed+timing[i].seconds,velocityProfile:timing[i].profile};
      elapsed+=timing[i].seconds;
    }
  }
  const result: MachineProgram={motions,clearanceZ,dynamics:settings.dynamics?.enabled?settings.dynamics:undefined,issues:unique,timeline:{...base,events,duration:elapsed,travelDistance,cleans:base.cleans+(settings.cleanBeforeStart&&base.strokes&&!base.issues.length?1:0),issues:unique}};
  if(baseline && !baseline.issues.length) {
    const rejected=unique.length>0 || elapsed>baseline.timeline.duration+1e-6;
    const chosen=rejected?baseline:result;
    return {...chosen,optimization:{originalStrokes:baseline.timeline.strokes,connectedStrokes:chosen.timeline.strokes,joins:rejected?0:joining.joins,addedPaintingMm:rejected?0:joining.addedDistance,beforeSeconds:baseline.timeline.duration,savedSeconds:Math.max(0,baseline.timeline.duration-chosen.timeline.duration),rejected}};
  }
  return result;
}
export function machineProgramToGrbl(program: MachineProgram, projectId: string, dryRun=false): string {
  if(program.issues.length) throw new Error("Cannot export: "+program.issues.join(" "));
  if(!program.timeline.strokes) throw new Error("Generate at least one painting stroke before export.");
  const n=(v:number)=>Number(v.toFixed(4)).toString();
  const comment=(v:string)=>v.replace(/[\r\n();]/g," ");
  const first=program.motions[0]?.from;
  const lines=["; Caravaiggio FluidNC / GRBL XYZ postprocessor v1", "; project="+comment(projectId), dryRun?"; DRY RUN: all XYZ paths projected to clearance Z":"; Painting with configured container procedures", "; Start with XY at the configured parking position; machine must be homed.", "G21", "G90", "G94", "G0 Z"+n(program.clearanceZ)];
  if(program.dynamics) {
    const d=program.dynamics;
    lines.push("; Timing assumes Cartesian FluidNC configuration; controller settings are not changed.",
      "; axes X/Y/Z max_rate_mm_per_min="+[d.maxRate.x,d.maxRate.y,d.maxRate.z].map(n).join("/"),
      "; axes X/Y/Z acceleration_mm_per_sec2="+[d.acceleration.x,d.acceleration.y,d.acceleration.z].map(n).join("/"),
      "; junction_deviation_mm="+n(d.junctionDeviation));
  }
  if(first) lines.push("G0 X"+n(first.x)+" Y"+n(first.y));
  let previousType="";
  for(const motion of program.motions) {
    if(motion.type!==previousType){lines.push("; "+motion.type+(motion.paintId?" paint="+comment(motion.paintId):""));previousType=motion.type;}
    const to={...motion.to,z:dryRun?program.clearanceZ:motion.to.z},from={...motion.from,z:dryRun?program.clearanceZ:motion.from.z};
    const distance=length(from,to);
    if(distance>0) lines.push("G1 X"+n(to.x)+" Y"+n(to.y)+" Z"+n(to.z)+" F"+n(motion.speed));
    else if(motion.seconds>0 && !dryRun) lines.push("G4 P"+n(motion.seconds));
  }
  lines.push("G0 Z"+n(program.clearanceZ),"; End at parking, tool raised");
  return lines.join("\n")+"\n";
}
