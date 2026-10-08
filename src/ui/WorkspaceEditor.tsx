import { WorkspaceZoneDialog } from "./WorkspaceZoneDialog.tsx";
import { applyLayoutProfile, captureLayout, loadLayoutProfiles, saveLayoutProfiles, type LayoutProfiles } from "../project/workspaceProfiles.ts";
import { useMemo, useRef, useState, type PointerEvent } from "react";
import { syncWorkspace, validateWorkspace, type Workspace, type WorkspaceZone } from "../core/workspace.ts";
import type { CaravaiggioProject } from "../project/model.ts";
type Props = { project: CaravaiggioProject; onChange: (workspace: Workspace) => void; onBack: () => void; onNext: () => void };
export function WorkspaceEditor({ project, onChange, onBack, onNext }: Props) {
  const workspace = useMemo(() => syncWorkspace(project.workspace, project.canvas, project.palette), [project.workspace, project.canvas, project.palette]);
  const [profileState, setProfileState] = useState<{ data: LayoutProfiles; message: string }>(() => {
    try { return { data: loadLayoutProfiles(), message: "" }; }
    catch { return { data: { version: 1, defaultId: null, profiles: [] }, message: "Saved profiles could not be loaded." }; }
  });
  const [profileId, setProfileId] = useState(() => profileState.data.defaultId ?? "");
  const [profileName, setProfileName] = useState(() => profileState.data.profiles.find(profile => profile.id === profileState.data.defaultId)?.name ?? "");
  const persistProfiles = (data: LayoutProfiles, message: string) => {
    try { saveLayoutProfiles(data); setProfileState({ data, message }); return true; }
    catch { setProfileState(current => ({ ...current, message: "Profiles could not be saved. Check local storage availability." })); return false; }
  };
  const [selection, setSelection] = useState("canvas");
  const [editingZone, setEditingZone] = useState<WorkspaceZone | null>(null);
  const issues = useMemo(() => validateWorkspace(workspace), [workspace]);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; startX: number; startY: number } | null>(null);
  const patch = (id: string, changes: Partial<WorkspaceZone>) => onChange({ ...workspace, zones: workspace.zones.map(zone => zone.id === id ? { ...zone, ...changes } : zone) });
  const position = (event: PointerEvent<SVGElement>) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  };
  const fill = (zone: WorkspaceZone) => zone.type === "paint" ? project.palette.find(paint => paint.id === zone.paintId)?.hex ?? "#888" : ({ canvas: "#eee8da", water: "#367eaa", wipe: "#827266", parking: "#4a6451", forbidden: "url(#workspace-forbidden)" })[zone.type];
  const numeric = (label: string, value: number, onUpdate: (value: number) => void, min = 0, disabled = false) => <label>{label}<input type="number" disabled={disabled} step="0.1" min={min} value={value} onChange={event => { if (event.target.value !== "" && Number.isFinite(Number(event.target.value))) onUpdate(Math.max(min, Number(event.target.value))); }} /></label>;
  return <section>
    <div className="intro"><p className="eyebrow">Step 04 · Workspace</p><h1>Arrange the machine workspace.</h1><p>Drag zones to position them. Double-click a zone to edit its dimensions and position in millimetres. Origin is at the top left; X points right and Y points down.</p></div>
    <div className="workspace-profiles">
      <label>Machine profile<select value={profileId} onChange={event => {
        setProfileId(event.target.value);
        setProfileName(profileState.data.profiles.find(profile => profile.id === event.target.value)?.name ?? "");
      }}><option value="">Current project layout</option>{profileState.data.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.id === profileState.data.defaultId ? " · Default" : ""}</option>)}</select></label>
      <button type="button" disabled={!profileId} onClick={() => {
        const profile = profileState.data.profiles.find(entry => entry.id === profileId);
        if (profile) { onChange(applyLayoutProfile(profile, project)); setProfileState(current => ({ ...current, message: `Applied ${profile.name}.` })); }
      }}>Apply profile</button>
      <label>Profile name<input value={profileName} placeholder="My painting machine" onChange={event => setProfileName(event.target.value)} /></label>
      <button type="button" disabled={!profileName.trim()} onClick={() => {
        const id = crypto.randomUUID();
        const data = { ...profileState.data, profiles: [...profileState.data.profiles, { id, name: profileName.trim(), workspace: captureLayout(workspace) }] };
        if (persistProfiles(data, "Profile saved. Choose Set as default to use it for new projects.")) setProfileId(id);
      }}>Save as new</button>
      <button type="button" disabled={!profileId || !profileName.trim()} onClick={() => persistProfiles({ ...profileState.data, profiles: profileState.data.profiles.map(profile => profile.id === profileId ? { ...profile, name: profileName.trim(), workspace: captureLayout(workspace) } : profile) }, "Profile updated.")}>Update profile</button>
      <button type="button" disabled={!profileId || profileId === profileState.data.defaultId} onClick={() => persistProfiles({ ...profileState.data, defaultId: profileId }, "Default profile selected for new projects.")}>Set as default</button>
      {profileState.data.defaultId && <button type="button" onClick={() => persistProfiles({ ...profileState.data, defaultId: null }, "Default profile cleared.")}>Clear default</button>}
      <p className="workspace-caption">Profiles are saved on this computer. New projects use the default; existing projects keep their own layout.</p>
      {profileState.message && <p role="status">{profileState.message}</p>}
    </div>
    <div className="workspace-layout">
      <div className="workspace-map">
        <svg ref={svg} viewBox={`-15 -15 ${workspace.width + 30} ${workspace.height + 30}`} aria-label="Machine workspace in millimetres"
          onPointerMove={event => { if (!drag.current) return; const point = position(event), current = drag.current; patch(current.id, { x: Math.round((current.x + point.x - current.startX) * 10) / 10, y: Math.round((current.y + point.y - current.startY) * 10) / 10 }); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <defs><pattern id="workspace-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M 25 0 L 0 0 0 25" fill="none" stroke="#ffffff12" strokeWidth="1" /></pattern><pattern id="workspace-forbidden" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#763730" /><path d="M-2 2L2-2M0 10L10 0M8 12L12 8" stroke="#d97868" strokeWidth="2" /></pattern></defs>
          <rect width={workspace.width} height={workspace.height} fill="#181916" stroke="#77736a" /><rect width={workspace.width} height={workspace.height} fill="url(#workspace-grid)" />
          {workspace.zones.map(zone => <g key={zone.id} role="button" aria-label={`Select ${zone.name}`} tabIndex={0} className="workspace-zone" onDoubleClick={() => { drag.current = null; setEditingZone(zone); }}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection(zone.id); setEditingZone(zone); } }}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSelection(zone.id); const point = position(event); drag.current = { id: zone.id, x: zone.x, y: zone.y, startX: point.x, startY: point.y }; }}>
            <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} rx={zone.type === "paint" || zone.type === "water" ? 5 : 1} fill={fill(zone)} stroke={selection === zone.id ? "#e7bf72" : "#ffffff70"} strokeWidth={selection === zone.id ? 3 : 1} />
            <text x={zone.x + zone.width / 2} y={zone.y + zone.height / 2} textAnchor="middle" dominantBaseline="middle" className="workspace-zone-label">{zone.type === "canvas" ? `Canvas · ${zone.width} × ${zone.height} mm` : zone.name}</text>
          </g>)}
        </svg>
        <p className="workspace-caption">{workspace.width} × {workspace.height} mm · Grid 25 mm · Safe travel Z {workspace.safeZ} mm</p>
      </div>
      <aside className="workspace-settings">
        <p className="eyebrow">Machine area</p><div className="workspace-fields">
          {numeric("Width · mm", workspace.width, width => onChange({ ...workspace, width }), 1)}
          {numeric("Height · mm", workspace.height, height => onChange({ ...workspace, height }), 1)}
          {numeric("Safe Z · mm", workspace.safeZ, safeZ => onChange({ ...workspace, safeZ }), 0.1)}
        </div>
        <p className="eyebrow">Zones</p><div className="workspace-zone-list">{workspace.zones.map(zone => <button type="button" key={zone.id} className={zone.id === selection ? "selected" : ""} onClick={() => setSelection(zone.id)} onDoubleClick={() => setEditingZone(zone)}>{zone.name}<small>{zone.type} · {zone.x}, {zone.y} mm</small></button>)}</div>
        <button type="button" onClick={() => { const id = crypto.randomUUID(); onChange({ ...workspace, zones: [...workspace.zones, { id, type: "forbidden", name: `Forbidden ${workspace.zones.filter(zone => zone.type === "forbidden").length + 1}`, x: 10, y: workspace.height - 60, width: 50, height: 40 }] }); setSelection(id); }}>+ Forbidden zone</button>
      </aside>
    </div>
    <div className={`workspace-validation ${issues.length ? "has-issues" : ""}`} role="status"><strong>{issues.length ? `${issues.length} layout issues` : "Layout fits the working area"}</strong>{issues.length ? <ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : <p>No overlaps or zones outside the area. Motion planning and clearance checks follow in the next phase.</p>}</div>
    {editingZone && <WorkspaceZoneDialog key={editingZone.id} zone={editingZone}
      onClose={() => setEditingZone(null)}
      onSave={zone => { patch(zone.id, zone); setEditingZone(null); }}
      onRemove={() => { onChange({ ...workspace, zones: workspace.zones.filter(zone => zone.id !== editingZone.id) }); setSelection("canvas"); setEditingZone(null); }} />}
    <div className="flow-actions"><button className="flow-back" onClick={onBack}>← Back</button><button className="flow-next" disabled={issues.length > 0} onClick={onNext}>Continue to Simulation →</button></div>
  </section>;
}
