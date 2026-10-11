import { useEffect, useState } from "react";
import type { ZoneProcedure } from "../core/machineSettings.ts";
import { defaultProcedure, procedureIssues } from "../core/machineSettings.ts";
type Props = { value: ZoneProcedure; type: string; safeZ: number; onChange: (value: ZoneProcedure) => void };
type NumericProps = { value: number; onChange: (value: number) => void; min?: number; step?: number; label?: string };
function ProcedureNumber({ value, onChange, min, step = .1, label }: NumericProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return <input aria-label={label} type="number" required min={min} step={step} value={draft}
    onChange={event => { setDraft(event.target.value); if (event.target.value !== "" && Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber); }}
    onBlur={() => setDraft(String(value))} />;
}
export function ProcedureEditor({ value, type, safeZ, onChange }: Props) {
  const issues = procedureIssues(value);
  const number = (label: string, current: number, change: (next: number) => void, min?: number, step = .1) => <label>{label}<ProcedureNumber min={min} step={step} value={current} onChange={change} /></label>;
  return <fieldset className="procedure-editor"><legend>{type === "water" ? "Brush washing" : type === "wipe" ? "Brush wiping" : "Paint loading"} · XYZ procedure</legend>
    <p className="workspace-caption">X/Y are offsets from the zone centre. Z is an absolute machine coordinate; higher Z raises the brush. Set clearance above the rim, including the brush holder. Each procedure starts and ends with the brush raised. Use the Wiping area for wiping after washing.</p>
    <div className="workspace-fields">
      {number("Clearance above rim · Z mm", value.clearanceZ, clearanceZ => onChange({ ...value, clearanceZ }))}
      {number("Service speed · mm/min", value.speed, speed => onChange({ ...value, speed }), .1)}
      {number("Repeat sequence", value.repeats, repeats => onChange({ ...value, repeats }), 1, 1)}
    </div>
    <p className="workspace-caption">At the first point the brush lowers vertically. Subsequent points define shaking, dipping, stirring or wiping. Dwell follows arrival at each point.</p>
    <div className="procedure-table-wrap"><table className="procedure-table"><thead><tr><th>Point</th><th>X offset · mm</th><th>Y offset · mm</th><th>Z · mm</th><th>Dwell · s</th><th>Order</th></tr></thead><tbody>
      {value.steps.map((point, index) => <tr key={index}><td>{index + 1}</td>{(["x", "y", "z", "seconds"] as const).map(field => <td key={field}><ProcedureNumber label={"Point " + (index + 1) + " " + field} min={field === "seconds" ? 0 : undefined} value={point[field]} onChange={next => onChange({ ...value, steps: value.steps.map((entry, i) => i === index ? { ...entry, [field]: next } : entry) })} /></td>)}<td className="procedure-actions">
        <button type="button" aria-label={"Move point " + (index + 1) + " up"} disabled={index === 0} onClick={() => { const steps = [...value.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; onChange({ ...value, steps }); }}>↑</button>
        <button type="button" aria-label={"Remove point " + (index + 1)} disabled={value.steps.length === 1} onClick={() => onChange({ ...value, steps: value.steps.filter((_, i) => i !== index) })}>×</button>
      </td></tr>)}
    </tbody></table></div>
    <div className="procedure-actions"><button type="button" disabled={value.steps.length >= 100} onClick={() => onChange({ ...value, steps: [...value.steps, { ...value.steps.at(-1)! }] })}>+ Point</button><button type="button" onClick={() => onChange(defaultProcedure(type, safeZ))}>Reset sequence</button></div>
    {!!issues.length && <p role="alert" className="workspace-caption">{issues.join(" ")}</p>}
  </fieldset>;
}
