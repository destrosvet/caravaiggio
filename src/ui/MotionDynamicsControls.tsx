import { useEffect, useState } from "react";
import { defaultMotionDynamics, type MotionDynamics } from "../core/machineSettings.ts";
function MotionNumber({ label, value, min, max, onCommit }: {label:string;value:number;min:number;max?:number;onCommit:(value:number)=>void}) {
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value]);
  const valid=draft.trim()!=="" && Number.isFinite(Number(draft)) && Number(draft)>=min && (max===undefined||Number(draft)<=max);
  return <label>{label}<input type="number" step="any" min={min} max={max} value={draft} aria-invalid={!valid} onChange={e=>setDraft(e.target.value)} onBlur={()=>{if(valid) {if(Number(draft)!==value) onCommit(Number(draft));}else setDraft(String(value));}} onKeyDown={e=>{if(e.key==="Enter") e.currentTarget.blur();if(e.key==="Escape"){e.preventDefault();setDraft(String(value));}}}/></label>;
}
export function MotionDynamicsControls({ value, onChange }: {value?:MotionDynamics;onChange:(value:MotionDynamics)=>void}) {
  const d=value??defaultMotionDynamics;
  return <details className="machine-dynamics-controls"><summary>FluidNC motion profile</summary>
    <p className="workspace-caption">Copy the calibrated values from the machine configuration. The initial values are examples. This profile is saved with Workspace and does not change the controller configuration.</p>
    <label className="simulation-order-toggle"><input type="checkbox" checked={d.enabled} onChange={e=>onChange({...d,enabled:e.target.checked})}/> Include acceleration and axis limits</label>
    <div className="workspace-fields">{(["x","y","z"] as const).map(axis=><MotionNumber key={axis+"rate"} label={axis.toUpperCase()+" maximum rate · mm/min"} value={d.maxRate[axis]} min={.001} onCommit={v=>onChange({...d,maxRate:{...d.maxRate,[axis]:v}})}/>)}
    {(["x","y","z"] as const).map(axis=><MotionNumber key={axis+"acceleration"} label={axis.toUpperCase()+" acceleration · mm/s²"} value={d.acceleration[axis]} min={.001} onCommit={v=>onChange({...d,acceleration:{...d.acceleration,[axis]:v}})}/>)}
    <MotionNumber label="Junction deviation · mm" value={d.junctionDeviation} min={.01} max={1} onCommit={v=>onChange({...d,junctionDeviation:v})}/></div>
    <p className="workspace-caption">FluidNC: axes.x/y/z.max_rate_mm_per_min, acceleration_mm_per_sec2 and junction_deviation_mm. 1 mm/s = 60 mm/min. Smaller junction deviation slows corners more. Cartesian XYZ estimate; actual timing also depends on controller buffering and streaming.</p>
  </details>;
}
