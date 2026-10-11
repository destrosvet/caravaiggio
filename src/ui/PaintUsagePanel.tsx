import { useEffect, useMemo, useState } from "react";
import { defaultPaintUsageSettings, estimatePaintUsage, type PaintUsageSettings } from "../core/paintUsage.ts";
import type { SimulationTimeline } from "../core/simulation.ts";
import type { PaletteColor } from "../project/model.ts";
const ml=(value:number)=>value>0 && value<.01 ? "< 0.01 ml" : "≈ " + value.toFixed(2) + " ml";
function CalibrationNumber({label,value,min,onCommit}:{label:string;value:number;min:number;onCommit:(v:number)=>void}) {
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value]);
  const valid=draft.trim()!=="" && Number.isFinite(Number(draft)) && Number(draft)>=min;
  return <label>{label}<input type="number" step="any" min={min} value={draft} aria-invalid={!valid} onChange={e=>setDraft(e.target.value)} onBlur={()=>{if(valid){if(Number(draft)!==value)onCommit(Number(draft));}else setDraft(String(value));}} onKeyDown={e=>{if(e.key==="Enter")e.currentTarget.blur();if(e.key==="Escape"){e.preventDefault();setDraft(String(value));}}}/></label>;
}
export function PaintUsagePanel({timeline,palette,settings,editingSettings,brushWidth,stale,onChange}:{timeline:SimulationTimeline;palette:readonly PaletteColor[];settings?:PaintUsageSettings;editingSettings?:PaintUsageSettings;brushWidth:number;stale:boolean;onChange:(s:PaintUsageSettings)=>void}) {
  const applied=settings??defaultPaintUsageSettings,editing=editingSettings??defaultPaintUsageSettings;
  const usage=useMemo(()=>timeline.issues.length ? [] : estimatePaintUsage(timeline,applied),[timeline,applied]);
  const total=usage.reduce((sum,row)=>sum+row.totalMl,0);
  return <section className="paint-usage" aria-label="Paint consumption">
    <p className="eyebrow">Paint consumption · rough estimate</p>
    <p className="workspace-caption">{settings ? "Using your coefficients" : "Illustrative coefficients — not calibrated"} · {applied.mlPerMetre} ml per metre + {applied.wastePerCleaningMl} ml per wash/wipe cycle. Calibrate for the {brushWidth} mm brush and paint mixture. Overlapping strokes count again; raised travel does not consume paint.</p>
    {timeline.issues.length ? <p>Consumption unavailable until the machine path issues are resolved.</p> : <div className="paint-usage-grid">
      <article className="paint-usage-card paint-usage-total"><h3>Total paint</h3><strong>{ml(total)}</strong><p>Painting + cleaning waste</p></article>
      {usage.map(row=>{const paint=palette.find(p=>p.id===row.paintId);return <article className="paint-usage-card" key={row.paintId} aria-label={(paint?.name??row.paintId)+" consumption"}>
        <h3><span className="paint-usage-swatch" style={{background:paint?.hex??"#888"}} aria-hidden="true"/>{paint?.name??row.paintId}</h3>
        <strong>{ml(row.totalMl)}</strong><p>{(row.distanceMm/1000).toFixed(2)} m of painting · {row.loads} loads</p>
        <dl><div><dt>On canvas</dt><dd>{ml(row.paintingMl)}</dd></div><div><dt>Cleaning waste</dt><dd>{ml(row.wasteMl)}</dd></div></dl>
      </article>;})}
    </div>}
    {stale && <p className="workspace-caption">These quantities belong to the previous paths. Recalculate in the preview header to apply changes.</p>}
    <details><summary>Calibrate paint consumption</summary><p className="workspace-caption">Measure the paint used by a known length of strokes with this brush, then divide ml by metres. Cleaning waste is an average allowance per colour wash and wipe; tune it from a measured run. Pressure, absorption and viscosity are represented by these empirical coefficients.</p>
      <div className="workspace-fields"><CalibrationNumber label="Paint per metre · ml/m" value={editing.mlPerMetre} min={.0001} onCommit={v=>onChange({...editing,mlPerMetre:v})}/><CalibrationNumber label="Waste per cleaning · ml" value={editing.wastePerCleaningMl} min={0} onCommit={v=>onChange({...editing,wastePerCleaningMl:v})}/></div>
    </details>
  </section>;
}
