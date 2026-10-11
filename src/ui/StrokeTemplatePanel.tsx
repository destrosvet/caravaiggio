import { useState } from "react";
import { ShadowPaintSelect } from "./ShadowPaintSelect.tsx";
import type { CaravaiggioProject } from "../project/model.ts";
import { readUserTemplates, strokeTemplateStorageKey } from "../project/strokeTemplateLibrary.ts";
import { strokeTemplates, applyStrokeTemplate, type StrokeTemplate } from "../core/strokeTemplates.ts";
import { strategySchemas, strategyParameters } from "../core/strategySchema.ts";
import { paintSimulationDefaults, paintSimulationParameters } from "../core/paintRaster.ts";
import type { StrokeGenerationSettings } from "../core/strokes.ts";
import { shadowDefaults, shadowParameters } from "../core/shadows.ts";
import { priorityDefaults, priorityParameters } from "../core/priority.ts";

export function PaintSimulationControls({ settings, onChange }: { settings: StrokeGenerationSettings; onChange: (settings: StrokeGenerationSettings) => void }) {
  const simulation = settings.paintSimulation ?? paintSimulationDefaults;
  return <details className="paint-simulation-controls"><summary>Wet paint simulation · Mixbox pigments</summary><p className="workspace-caption">Preview estimates pigment blending and colour carried by the brush. These controls do not change machine trajectories.</p>
    {paintSimulationParameters.map(p => <label key={p.key}>{p.label} · {simulation[p.key]}
      <input type="range" min={p.min} max={p.max} step={p.step} value={simulation[p.key]} onChange={e => onChange({ ...settings, paintSimulation: { ...simulation, [p.key]: Number(e.target.value) } })} />
    </label>)}
  </details>;
}
export function StrokeTemplatePanel({ project, onChange, onEditFocus, editingFocus = false }: { project: CaravaiggioProject; onChange: (project: CaravaiggioProject) => void; onEditFocus?: () => void; editingFocus?: boolean }) {
  const [initialLibrary] = useState(() => {
    try { return { templates: readUserTemplates(localStorage.getItem(strokeTemplateStorageKey)), error: "" }; }
    catch { return { templates: [] as StrokeTemplate[], error: "Could not read the saved template library. It will not be overwritten." }; }
  });
  const [storageError, setStorageError] = useState(initialLibrary.error);
  const [templates, setTemplates] = useState(initialLibrary.templates);
  const [name, setName] = useState("");
  const settings = project.strokeSettings, strategy = settings.strategy ?? "legacy";
  const all = [...strokeTemplates, ...templates];
  const selectedId = settings.templateId ?? (strategy === "legacy" ? "custom" : strategy === "dabs" ? "colour-dabs" : strategy);
  const selected = all.find(t => t.id === selectedId);
  const set = (patch: Partial<StrokeGenerationSettings>) => onChange({ ...project, strokeSettings: { ...settings, ...patch } });
  const parameters = strategyParameters(strategy, settings.strategyParameters);
  const apply = (template: StrokeTemplate) => onChange({ ...project, ...applyStrokeTemplate(template, settings.seed) });
  const persist = (next: StrokeTemplate[]) => {
    if (initialLibrary.error) return false;
    try { localStorage.setItem(strokeTemplateStorageKey, JSON.stringify({ version: 1, templates: next })); setTemplates(next); setStorageError(""); return true; }
    catch { setStorageError("Could not save the template library on this device."); return false; }
  };
  const compare = (brush: typeof project.brush, config: StrokeGenerationSettings) => JSON.stringify({ brush, ...config, seed: undefined, templateId: undefined,
    strategy: config.strategy ?? "legacy", strategyParameters: strategyParameters(config.strategy ?? "legacy", config.strategyParameters), paintSimulation: config.paintSimulation ?? paintSimulationDefaults, shadows: config.shadows ?? shadowDefaults, priority: config.priority ?? priorityDefaults });
  const modified = selected && compare(project.brush, settings) !== compare(selected.brush, selected.settings);
  const shadows = settings.shadows ?? shadowDefaults;
  const priority = settings.priority ?? priorityDefaults;
  return <div className="stroke-template-panel"><p className="eyebrow">Trajectory template</p>
    <label>Template<select value={selected ? selectedId : "custom"} onChange={e => { const template = all.find(t => t.id === e.target.value); if (template) apply(template); }}>
      {!selected && <option value="custom">Project settings</option>}
      <optgroup label="Built-in templates">{strokeTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
      {templates.length > 0 && <optgroup label="My templates">{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
    </select></label>
    <p className="workspace-caption">{selected?.description ?? "Saved project parameters are active."}{modified ? " · Modified" : ""}</p>
    {selected && <button className="template-action" type="button" onClick={() => apply(selected)}>Reset to template</button>}
    <label>Save current settings as<input value={name} maxLength={100} placeholder="My painting template" onChange={e => setName(e.target.value)} /></label>
    <button className="template-action template-action-primary" type="button" disabled={!!initialLibrary.error || !name.trim() || templates.length >= 200} onClick={() => {
      const id = `user-${crypto.randomUUID()}`;
      const template: StrokeTemplate = { id, name: name.trim(), description: `Custom ${strategy} template`, brush: { ...project.brush }, settings: { ...settings, templateId: id, strategyParameters: { ...parameters } } };
      if (persist([...templates, template])) { setName(""); onChange({ ...project, strokeSettings: template.settings }); }
    }}>Save new template</button>
    {selectedId.startsWith("user-") && selected && <button className="template-action" type="button" onClick={() => { if (persist(templates.filter(t => t.id !== selectedId))) set({ templateId: undefined }); }}>Remove from my templates</button>}
    {storageError && <p role="alert">{storageError}</p>}
    {strategy !== "curved-offsets" && <label>Variation seed<span className="seed-input-row"><input value={settings.seed} placeholder="Blank creates a new variant" onChange={e => set({ seed: e.target.value })} /><button type="button" onClick={() => set({ seed: crypto.randomUUID().slice(0, 8) })}>New</button></span></label>}
    {strategy !== "legacy" ? <><p className="eyebrow">{strategySchemas[strategy].name} parameters</p>
      {strategySchemas[strategy].parameters.map(p => <label key={p.key}>{p.label} · {parameters[p.key]} {p.unit}
        <input type="range" min={p.min} max={p.max} step={p.step} value={parameters[p.key]} onChange={e => set({ strategyParameters: { ...parameters, [p.key]: Number(e.target.value) } })} />
      </label>)}
    </> : <details open><summary>Trajectory parameters</summary>
      <label>Direction<select value={settings.direction} onChange={e => set({ direction: e.target.value as StrokeGenerationSettings["direction"] })}>
        {["horizontal", "vertical", "random", "flow", "image-contours"].map(value => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label>Stroke geometry<select value={settings.geometry} onChange={e => set({ geometry: e.target.value as StrokeGenerationSettings["geometry"] })}>{["linear", "curved", "contour", "mixed"].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Curvature · {settings.curvature}<input type="range" min="0" max="1" step=".05" value={settings.curvature} onChange={e => set({ curvature: Number(e.target.value) })} /></label>
      {settings.direction === "image-contours" && ([
        ["contourSmoothing", "Smoothing", 0, 1, .05, .5], ["contourSensitivity", "Edge sensitivity", 0, 1, .05, .5], ["contourGapMm", "Connect gaps · mm", 0, 10, .5, 2],
      ] as const).map(([key, label, min, max, step, fallback]) => <label key={key}>{label} · {settings[key] ?? fallback}<input type="range" min={min} max={max} step={step} value={settings[key] ?? fallback} onChange={e => set({ [key]: Number(e.target.value) })} /></label>)}
      <label className="trajectory-toggle"><input type="checkbox" checked={settings.joinNearbyStrokes !== false} disabled={settings.style === "pointillism"} onChange={e => set({ joinNearbyStrokes: e.target.checked })} /><span>Join nearby strokes</span></label>
    </details>}
    <details open><summary>Brush movement and paint load</summary>
      {strategy === "legacy" || strategy === "flow-curves" ? <label>Overlap · {settings.overlap}<input type="range" min="0" max=".8" step=".05" value={settings.overlap} onChange={e => set({ overlap: Number(e.target.value) })} /></label> : null}
      <label>Minimum stroke · {settings.minStrokeLengthMm ?? 1} mm<input type="range" min="1" max="150" value={settings.minStrokeLengthMm ?? 1} onChange={e => { const min = Number(e.target.value); set({ minStrokeLengthMm: min, maxStrokeLengthMm: Math.max(min, settings.maxStrokeLengthMm ?? 75) }); }} /></label>
      <label>Maximum stroke · {settings.maxStrokeLengthMm ?? 75} mm<input type="range" min="1" max="300" value={settings.maxStrokeLengthMm ?? 75} onChange={e => { const max = Number(e.target.value); set({ maxStrokeLengthMm: max, minStrokeLengthMm: Math.min(max, settings.minStrokeLengthMm ?? 1) }); }} /></label>
      <label>Speed · {settings.speedMmPerMin} mm/min<input type="range" min="100" max="2000" step="50" value={settings.speedMmPerMin} onChange={e => set({ speedMmPerMin: Number(e.target.value) })} /></label>
      <label>Pressure · {settings.pressure}<input type="range" min="0" max="1" step=".05" value={settings.pressure} onChange={e => set({ pressure: Number(e.target.value) })} /></label>
      <label>Paint load length · {settings.paintLoadLengthMm ?? 120} mm<input type="range" min="10" max="500" step="10" value={settings.paintLoadLengthMm ?? 120} onChange={e => set({ paintLoadLengthMm: Number(e.target.value) })} /></label>
    </details>
    <details open><summary>Subject and detail priority</summary>
      <p className="workspace-caption">Flow curves can devote more strokes to important areas. Combine automatic photo details with a painted focus region, or turn off automatic detection to use only your painted focus. Regenerate to apply.</p>
      {strategy !== "flow-curves" ? <p className="workspace-caption">Available with Flow curves, Realism and Expressionism.</p> : <>
        <label className="trajectory-toggle"><input type="checkbox" checked={priority.enabled} onChange={e => set({ priority: { ...priority, enabled: e.target.checked } })} /><span>Prioritise photo details</span></label>
        {priority.enabled && <>
          <label className="trajectory-toggle"><input type="checkbox" checked={priority.automatic !== false} onChange={e => set({ priority: { ...priority, automatic: e.target.checked } })} /><span>Detect photo details automatically</span></label>
          <label className="trajectory-toggle"><input type="checkbox" checked={priority.simplifyBackground === true} onChange={e => set({ priority: { ...priority, simplifyBackground: e.target.checked } })} /><span>Simplify background directions</span></label>
          {priorityParameters.filter(p => (p.key !== "scaleMm" || priority.automatic !== false) && (p.key !== "calm" || priority.simplifyBackground === true)).map(p => <label key={p.key}>{p.label} · {priority[p.key]}<input type="range" min={p.min} max={p.max} step={p.step} value={priority[p.key]} onChange={e => set({ priority: { ...priority, [p.key]: Number(e.target.value) } })} /></label>)}
          <p className="workspace-caption">Priority preserves the base curves and adds detail strokes locally. Background direction changes only when Simplify background directions is enabled.</p>
          {priority.automatic === false && <p className="workspace-caption">Only the painted focus region contributes to the importance map. Follow image structure still controls stroke direction separately.</p>}
          <button type="button" className="template-action" aria-pressed={editingFocus} disabled={!project.sourceImage || !onEditFocus} onClick={onEditFocus}>{editingFocus ? "Finish painting focus" : "Paint a focus region"}</button>
          <p className="workspace-caption">Paint over the subject in the preview with a soft brush. Orange marks show your focus mask; erase or clear it in the preview toolbar. Regenerate to apply. Detail strokes can use the shorter minimum above; a large brush still cannot reproduce tiny colour areas.</p>
        </>}
      </>}
    </details>
    <details open><summary>Shadow detail from the photo</summary>
      <p className="workspace-caption">Adds a second pass in areas darker than their base paint. Noise is smoothed; strokes stay inside the colour region. Regenerate to apply.</p>
      <label className="trajectory-toggle"><input type="checkbox" checked={shadows.enabled} onChange={e => set({ shadows: { ...shadows, enabled: e.target.checked } })} /><span>Add shadow strokes</span></label>
      {shadows.enabled && <>
        <ShadowPaintSelect paints={project.palette} value={shadows.paintId} onChange={paintId => set({ shadows: { ...shadows, paintId } })} />
        {shadowParameters.map(p => <label key={p.key}>{p.label} · {shadows[p.key]}<input type="range" min={p.min} max={p.max} step={p.step} value={shadows[p.key]} onChange={e => set({ shadows: { ...shadows, [p.key]: Number(e.target.value) } })} /></label>)}
        <p className="workspace-caption">The palette must contain a darker paint. Repeating the darkest paint cannot deepen its tone. Narrow details smaller than the brush are skipped.</p>
      </>}
    </details>
    <PaintSimulationControls settings={settings} onChange={next => onChange({ ...project, strokeSettings: next })} />
  </div>;
}
