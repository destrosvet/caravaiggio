import { useEffect, useRef, useState } from "react";
import { editableFocusMask, paintFocusMask, type FocusMask, type PrioritySettings } from "../core/priority.ts";

export function FocusMaskEditor({ settings, aspect, radius, erase, onChange }: {
  settings: PrioritySettings; aspect: number; radius: number; erase: boolean;
  onChange: (settings: PrioritySettings) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ point: { x: number; y: number }; mask: FocusMask } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const draw = (mask: FocusMask) => {
    const c = canvas.current; if (!c) return;
    c.width = mask.width; c.height = mask.height;
    const context = c.getContext("2d"); if (!context) return;
    const data = context.createImageData(mask.width, mask.height);
    mask.values.forEach((v, i) => { data.data.set([255, 135, 35, Math.round(v * .55)], i * 4); });
    context.putImageData(data, 0, 0);
  };
  useEffect(() => { draw(editableFocusMask(settings, aspect)); }, [settings, aspect]);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.stopPropagation(); const current = drag.current; if (!current) return;
    drag.current = null;
    onChange({ ...settings, focus: false, mask: current.mask });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="focus-mask-layer">
    <canvas ref={canvas} aria-label="Paint subject priority mask" style={{ touchAction: "none" }}
      onPointerDown={event => {
        event.stopPropagation(); if (event.button !== 0) return;
        const p = point(event), mask = paintFocusMask(editableFocusMask(settings, aspect), p, p, radius, erase);
        drag.current = { point: p, mask }; draw(mask); setCursor(p);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        event.stopPropagation(); const p = point(event); setCursor(p);
        if (!drag.current) return;
        const mask = paintFocusMask(drag.current.mask, drag.current.point, p, radius, erase);
        drag.current = { point: p, mask }; draw(mask);
      }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onPointerLeave={() => { if (!drag.current) setCursor(null); }} />
    {cursor && <span className={`focus-brush-cursor${erase ? " erasing" : ""}`} style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%`, width: `${radius * 200 * Math.min(1, 1 / aspect)}%`, height: `${radius * 200 * Math.min(1, aspect)}%` }} />}
  </div>;
}
