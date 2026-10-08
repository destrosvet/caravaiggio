import { PhotoEyedropper } from "./PhotoEyedropper.tsx";
import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { hexToRgb } from "../core/color.ts";
import { hexToHsv, hsvToHex } from "../core/colorPicker.ts";

type Props = { name: string; hex: `#${string}`; image: string | undefined; sourceCanvas: RefObject<HTMLCanvasElement | null>; onChange: (hex: `#${string}`) => void; onClose: () => void };
export function ColorPicker({ name, hex, image, sourceCanvas, onChange, onClose }: Props) {
  const original = useRef(hex);
  const [hsv, setHsv] = useState<readonly [number, number, number]>(() => hexToHsv(hex));
  const [hexText, setHexText] = useState<string>(hex);
  const [sampling, setSampling] = useState(false);
  const [invalidHex, setInvalidHex] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const [h, s, v] = hsv;
  const current = hsvToHex(h, s, v);
  const rgb = hexToRgb(current);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => { if (!sampling) dialog.current?.focus(); }, [sampling]);
  const update = (next: readonly [number, number, number]) => {
    setHsv(next);
    const color = hsvToHex(...next);
    setHexText(color); setInvalidHex(false); onChange(color);
  };
  const choose = (color: `#${string}`) => {
    const next = hexToHsv(color);
    update([next[1] === 0 ? h : next[0], next[1], next[2]]);
  };
  const pickSurface = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    update([h, Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), Math.max(0, Math.min(100, 100 - (event.clientY - rect.top) / rect.height * 100))]);
  };
  const commitHex = () => {
    const candidate = hexText.startsWith("#") ? hexText : `#${hexText}`;
    if (/^#[0-9a-f]{6}$/i.test(candidate)) choose(candidate.toUpperCase() as `#${string}`);
    else setInvalidHex(true);
  };
  if (sampling) return <PhotoEyedropper source={sourceCanvas}
    onPick={color => { choose(color); onClose(); }}
    onCancel={() => setSampling(false)} />;
  return <div className="color-dialog-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="custom-color-dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title" ref={dialog} tabIndex={-1}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"]');
          if (!controls?.length) return;
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
      <header className="picker-header"><h2 id="picker-title">Colour chooser · {name}</h2><button type="button" aria-label="Close colour chooser" onClick={onClose}>×</button></header>
      <div className="picker-body">
        <div className="picker-controls">
          <label className="picker-hue-label">Hue <input className="picker-hue" aria-label="Hue" type="range" min="0" max="359" step="1" value={h} onChange={event => update([Number(event.target.value), s, v])} /></label>
          <div className="picker-surface" style={{ backgroundColor: hsvToHex(h, 100, 100) }} role="slider" aria-label="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s)} aria-valuetext={`Saturation ${Math.round(s)}%, brightness ${Math.round(v)}%`} tabIndex={0}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pickSurface(event); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pickSurface(event); }}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onKeyDown={event => {
              const step = event.shiftKey ? 10 : 1;
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                event.preventDefault(); update([h, Math.max(0, Math.min(100, s + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0))), Math.max(0, Math.min(100, v + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0)))]);
              }
            }}><span className="picker-cursor" style={{ left: `${s}%`, top: `${100 - v}%` }} /></div>
        </div>
        <aside className="picker-values">
          <div className="picker-swatches"><div style={{ background: original.current }} title="Original colour" /><div style={{ background: current }} title="Selected colour" /></div>
          <div className="picker-number-grid">
            {(["r", "g", "b"] as const).map(channel => <label key={channel}>{channel.toUpperCase()}<input aria-label={`${channel.toUpperCase()} channel`} type="number" min="0" max="255" value={rgb[channel]} onChange={event => {
              if (!event.target.value) return;
              const next = { ...rgb, [channel]: Math.max(0, Math.min(255, Math.round(Number(event.target.value)))) };
              choose(`#${[next.r, next.g, next.b].map(value => value.toString(16).padStart(2, "0")).join("")}`);
            }} /></label>)}
            {(["H", "S", "V"] as const).map((label, index) => <label key={label}>{label}<input aria-label={index === 0 ? "Hue degrees" : index === 1 ? "Saturation percent" : "Brightness percent"} type="number" min="0" max={index === 0 ? 359 : 100} value={Math.round(hsv[index])} onChange={event => {
              if (!event.target.value) return;
              const next: [number, number, number] = [...hsv]; next[index] = Math.max(0, Math.min(index === 0 ? 359 : 100, Number(event.target.value))); update(next);
            }} /></label>)}
          </div>
          <label className="picker-hex">HEX<input aria-label="Hex colour" value={hexText} aria-invalid={invalidHex} maxLength={7} onChange={event => { setHexText(event.target.value); setInvalidHex(false); }} onBlur={commitHex} onKeyDown={event => { if (event.key === "Enter") commitHex(); }} /></label>
          {invalidHex && <small role="alert">Enter six hexadecimal digits, e.g. #72A8D6.</small>}
          <button type="button" className={sampling ? "picker-sampling" : ""} disabled={!image} onClick={() => setSampling(value => !value)}>⌖ Pick from photo</button>
          <p className="picker-help">Changes update the palette and preview immediately.</p>
        </aside>
      </div>
      <footer className="picker-footer"><button type="button" onClick={() => { onChange(original.current); onClose(); }}>Cancel</button><button type="button" className="flow-next" onClick={onClose}>Done</button></footer>
    </div>
  </div>;
}
