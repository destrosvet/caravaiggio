import { defaultAiPosterizationSettings, type AiPosterizationSettings } from "../core/aiPosterization.ts";
import type { PosterizationSettings } from "../project/model.ts";

type Props = {
  settings: PosterizationSettings;
  onChange: (settings: PosterizationSettings) => void;
  analysis: { status: "loading" | "ready" | "error"; subjects?: number; details?: number; faces?: number; recognitionDetails?: number; hairDetails?:number; accessoryDetails?:number; error?: string };
  onRetry: () => void;
};

export function AiPosterizationControls({ settings, onChange, analysis, onRetry }: Props) {
  const ai = settings.ai ?? defaultAiPosterizationSettings;
  const updateAi = (patch: Partial<AiPosterizationSettings>) => onChange({ ...settings, ai: { ...ai, ...patch } });
  return <div className="ai-posterization-controls">
    <label>Posterization method
      <select value={settings.method ?? "classic"} onChange={event => onChange({ ...settings, method: event.target.value as "classic" | "sam3" })}>
        <option value="classic">Classical posterization</option>
        <option value="sam3">AI assisted · local SAM 3</option>
      </select>
    </label>
    {settings.method === "sam3" && <>
      <p className="workspace-caption">Automatic masks protect human and animal faces, including eyes, mouths, noses, muzzles and whiskers. Human hair, beards and accessories such as glasses, scarves, hats, jewellery, headphones and smoking pipes are also prioritized. Small faces are analysed separately. Images stay on this computer. Detection quality depends on the image.</p>
      <p className="ai-analysis-status" role={analysis.status === "error" ? "alert" : "status"}>
        {analysis.status === "ready" ? "SAM 3 ready · " + analysis.subjects + " subject masks · " + analysis.details + " detail masks" + (analysis.faces !== undefined ? " · " + analysis.faces + " face/head regions · " + analysis.recognitionDetails + " facial feature masks" : "") + (analysis.hairDetails!==undefined ? " · " + analysis.hairDetails + " hair masks · " + analysis.accessoryDetails + " accessory masks" : "") : analysis.status === "error" ? analysis.error : "Analysing with local SAM 3…"}
      </p>
      {analysis.status === "error" && <button type="button" className="template-action" onClick={onRetry}>Retry AI analysis</button>}
      <label>Background simplification · {ai.backgroundRadiusMm.toFixed(1)} mm
        <input type="range" min="0" max="8" step=".1" value={ai.backgroundRadiusMm} onChange={event => updateAi({ backgroundRadiusMm: Number(event.target.value) })}/>
      </label>
      <p className="workspace-caption">Recognized face features and accessories keep their colour detail; hair silhouettes stay protected. These details gain a little contrast and receive a final detail stroke pass in every style. These short detail strokes may fall below the general minimum length. Brush width and palette still limit the detail you can paint.</p>
      <label>Other detail protection · {Math.round(ai.detailProtection * 100)}%
        <input type="range" min="0" max="1" step=".05" value={ai.detailProtection} onChange={event => updateAi({ detailProtection: Number(event.target.value) })}/>
      </label>
      <label className="ai-fill-toggle"><input type="checkbox" checked={ai.fillGaps??true} onChange={event=>updateAi({fillGaps:event.target.checked})}/> Fill gaps with an underpainting</label>
      <p className="workspace-caption">Fills uncovered areas with brush-scale colours before the artistic and face detail passes. Short fills can be below the general minimum length. Applies to continuous painting styles; turn off for a more open composition.</p>
      <label>Additional face shades · {ai.faceShadeCount ?? 0}
        <input type="range" min="0" max="8" step="1" value={ai.faceShadeCount ?? 0} onChange={event => updateAi({ faceShadeCount: Number(event.target.value) })}/>
      </label>
      <p className="workspace-caption">Adds up to this many paints sampled from detected faces and animal heads, for richer highlights and shadows. Zero keeps your original palette. Each added paint needs a cup in Workspace. Lock a shade to keep it when this setting changes; editing its colour also locks it. More shades apply to all detected faces together.</p>
      <details className="ai-service-help"><summary>Local AI setup</summary>
        <p>Install once with <code>tools/sam3/setup.ps1</code> using Python 3.12. Put approved <code>sam3.pt</code> weights in <code>artifacts/sam3/models</code>.</p>
        <p>Start with <code>tools/sam3/start.ps1</code>, then retry. The service uses your NVIDIA GPU; the first analysis loads the model. Classical posterization works without it.</p>
      </details>
    </>}
  </div>;
}
