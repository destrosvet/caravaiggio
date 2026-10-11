import { ProcedureEditor } from "./ProcedureEditor.tsx";
import { defaultProcedure, procedureIssues } from "../core/machineSettings.ts";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceZone } from "../core/workspace.ts";
type Props = { zone: WorkspaceZone; safeZ: number; onSave: (zone: WorkspaceZone) => void; onClose: () => void; onRemove: () => void };
export function WorkspaceZoneDialog({ zone, safeZ, onSave, onClose, onRemove }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const isService = ["paint", "water", "wipe"].includes(zone.type);
  const [procedure, setProcedure] = useState(() => zone.procedure ?? defaultProcedure(zone.type, safeZ));
  const [name, setName] = useState(zone.name);
  const [values, setValues] = useState(() => ({ x: String(zone.x), y: String(zone.y), width: String(zone.width), height: String(zone.height) }));
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="workspace-zone-dialog" aria-labelledby="zone-dialog-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <form onSubmit={event => {
      event.preventDefault();
      const next = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])) as { x: number; y: number; width: number; height: number };
      if (!name.trim() || Object.values(next).some(value => !Number.isFinite(value))) return;
      if (isService && procedureIssues(procedure).length) return;
      onSave({ ...zone, ...next, name: name.trim(), ...(isService ? { procedure } : {}) });
    }}>
      <header className="picker-header"><h2 id="zone-dialog-title">{zone.name} · Parameters</h2><button type="button" aria-label="Close zone parameters" onClick={onClose}>×</button></header>
      <p className="workspace-caption">Positions and dimensions in millimetres. X/Y refer to the top-left corner.</p>
      <label className="zone-name-field">Name<input autoFocus value={name} required disabled={zone.type === "paint"} onChange={event => setName(event.target.value)} /></label>
      <div className="workspace-fields">
        {(["x", "y", "width", "height"] as const).map(field => <label key={field}>{({ x: "X position", y: "Y position", width: "Width", height: "Height" })[field]} · mm
          <input type="number" required step="0.1" min={field === "x" || field === "y" ? 0 : 1} disabled={zone.type === "canvas" && (field === "width" || field === "height")} value={values[field]}
            onChange={event => setValues(current => ({ ...current, [field]: event.target.value }))} />
        </label>)}
      </div>
      {zone.type === "canvas" && <p className="workspace-caption">Canvas dimensions follow Image settings.</p>}
      {isService && <ProcedureEditor value={procedure} type={zone.type} safeZ={safeZ} onChange={setProcedure} />}
      <footer className="picker-footer">
        {zone.type === "forbidden" && <button type="button" className="zone-remove-button" onClick={onRemove}>Remove zone</button>}
        <button type="button" onClick={onClose}>Cancel</button><button type="submit" disabled={isService && !!procedureIssues(procedure).length} className="flow-next">Save</button>
      </footer>
    </form>
  </dialog>;
}
