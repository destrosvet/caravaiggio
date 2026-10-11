import { useMemo, useState } from "react";
import type { PaintingPlan } from "../core/model.ts";
import { buildMachineProgram, machineProgramToGrbl, type MachinePlanSnapshot } from "../core/machineProgram.ts";
import { syncWorkspace } from "../core/workspace.ts";
import { hasNativeProjectFiles, saveNativeGcode } from "../platform/projectFiles.ts";
import type { CaravaiggioProject } from "../project/model.ts";
type Props = { project: CaravaiggioProject; plan: PaintingPlan | null; onBack: () => void; onWorkspace: () => void; onRegenerate: () => void; machinePaths?: MachinePlanSnapshot | null; onRecalculate?: () => void };
export function MachineExport({ project, plan, onBack, onWorkspace, onRegenerate, machinePaths, onRecalculate }: Props) {
  const [dryRun, setDryRun] = useState(true), [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const workspace = useMemo(() => syncWorkspace(project.workspace, project.canvas, project.palette), [project.workspace, project.canvas, project.palette]);
  const program = useMemo(() => {
    if (!plan) return null;
    const capacity = project.strokeSettings.paintLoadLengthMm ?? 120;
    if (machinePaths !== undefined) return machinePaths?.sourcePlan === plan && machinePaths.workspaceSignature === JSON.stringify(workspace) && machinePaths.capacity === capacity && machinePaths.brushWidth === project.brush.widthMm ? machinePaths.program : null;
    return buildMachineProgram(plan, workspace, capacity, project.brush.widthMm);
  }, [plan, workspace, project.strokeSettings.paintLoadLengthMm, project.brush.widthMm, machinePaths]);
  const gcode = useMemo(() => program && !program.issues.length && program.timeline.strokes ? machineProgramToGrbl(program, project.id, dryRun) : "", [program, project.id, dryRun]);
  const paths = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const motion of program?.motions ?? []) {
      if (motion.from.x === motion.to.x && motion.from.y === motion.to.y) continue;
      const key = motion.type === "stroke" ? project.palette.find(p => p.id === motion.paintId)?.hex ?? "#fff" : motion.type === "move" ? "#e7bf7270" : "#67c7d0";
      const group = groups.get(key) ?? []; group.push("M" + motion.from.x + " " + motion.from.y + "L" + motion.to.x + " " + motion.to.y); groups.set(key, group);
    }
    return [...groups.entries()];
  }, [program, project.palette]);
  async function download() {
    if (!gcode || saving) return;
    setSaving(true); setMessage("");
    try {
      const name = (project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "") || "painting") + (dryRun ? "-dry-run" : "") + ".gcode";
      if (hasNativeProjectFiles) { const path = await saveNativeGcode(gcode, name); if (path) setMessage("Saved " + path); }
      else { const url = URL.createObjectURL(new Blob([gcode], { type: "text/plain;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("G-code downloaded."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save G-code."); }
    finally { setSaving(false); }
  }
  if (!plan) return <section className="planned-step"><p className="eyebrow">Step 06 · Export</p><h1>Generate the current strokes first.</h1><p>The source, palette or brush settings changed, or no strokes have been generated.</p><button className="flow-next" onClick={onRegenerate}>Generate strokes →</button></section>;
  if (!program) return <section className="planned-step"><p className="eyebrow">Step 06 · Export</p><h1>Recalculate the machine paths first.</h1><p>Machine settings changed or the paths have not been calculated. Return to Simulation and recalculate before exporting.</p><button className="flow-next" onClick={onRecalculate ?? onBack}>Recalculate in Simulation →</button></section>;
  return <section><div className="intro"><p className="eyebrow">Step 06 · Export</p><h1>Export the machine program.</h1><p>FluidNC / GRBL XYZ motions follow the same plan as Simulation. Configure container heights and service sequences in Workspace.</p></div>
    <div className="simulation-layout"><div className="simulation-preview">
      <svg className="machine-route-preview" viewBox={"0 0 " + workspace.width + " " + workspace.height} role="img" aria-label="Validated machine travel and service paths">
        <rect width={workspace.width} height={workspace.height} fill="#181916" />
        {workspace.zones.map(zone => <g key={zone.id}><rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} fill={zone.type === "forbidden" ? "#763730" : "#ffffff10"} stroke="#ffffff40" /><text x={zone.x + 3} y={zone.y + 12} fontSize="9" fill="#bbb">{zone.name}</text></g>)}
        {paths.map(([color, path]) => <path key={color} d={path.join(" ")} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
      </svg><p className="workspace-caption">Paint colours · Gold: raised travel · Blue: container and wiping movements. Z motion is visible in Simulation.</p>
    </div><aside className="simulation-stats"><strong>{program.issues.length ? "Export blocked" : "Validation passed"}</strong><dl><dt>Strokes</dt><dd>{program.timeline.strokes}</dd><dt>Paint loads</dt><dd>{program.timeline.loads}</dd><dt>Cleaning cycles</dt><dd>{program.timeline.cleans}</dd><dt>Estimated execution</dt><dd>{(program.timeline.duration / 60).toFixed(1)} min</dd><dt>Safe travel Z</dt><dd>{program.clearanceZ} mm</dd><dt>XYZ motions</dt><dd>{program.motions.length}</dd></dl>
      <label className="simulation-order-toggle"><input type="checkbox" checked={dryRun} onChange={event => { setDryRun(event.target.checked); setMessage(""); }} /> Dry run · keep the brush raised</label>
      <p className="workspace-caption">Machine must be homed, with XY at the configured parking position and the same Z origin used in Workspace. The first command raises Z. Dry run follows the XY route at clearance height and skips dipping and dwell.</p>
      <button className="flow-next" disabled={!gcode || saving} onClick={download}>{saving ? "Saving…" : dryRun ? "Export dry-run G-code" : "Export painting G-code"}</button><p role="status">{message}</p>
    </aside></div>
    {!!program.issues.length && <div className="workspace-validation has-issues" role="alert"><strong>Resolve these issues before export:</strong><ul>{program.issues.map(issue => <li key={issue}>{issue}</li>)}</ul><button onClick={onWorkspace}>Edit Workspace</button></div>}
    {!!gcode && <details className="gcode-preview"><summary>Preview G-code · {gcode.split("\n").length - 1} lines</summary><pre>{gcode.split("\n").slice(0, 250).join("\n")}</pre><p className="workspace-caption">Preview shows the first 250 lines. The exported file contains the complete program.</p></details>}
    <div className="flow-actions"><button className="flow-back" onClick={onBack}>← Simulation</button><button className="flow-back" onClick={onWorkspace}>Edit Workspace</button></div>
  </section>;
}
