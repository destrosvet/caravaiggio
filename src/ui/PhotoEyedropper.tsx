import { useEffect, useRef, useState, type RefObject } from "react";

type Props = {
  source: RefObject<HTMLCanvasElement | null>;
  onPick: (hex: `#${string}`) => void;
  onCancel: () => void;
};
type Sample = { clientX: number; clientY: number; x: number; y: number; hex: `#${string}` };
export function PhotoEyedropper({ source, onPick, onCancel }: Props) {
  const overlay = useRef<HTMLDivElement>(null);
  const lens = useRef<HTMLCanvasElement>(null);
  const [sample, setSample] = useState<Sample | null>(null);
  useEffect(() => { overlay.current?.focus(); }, []);
  const sampleAt = (clientX: number, clientY: number): Sample | null => {
    const canvas = source.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return null;
    const x = Math.min(canvas.width - 1, Math.floor((clientX - rect.left) / rect.width * canvas.width));
    const y = Math.min(canvas.height - 1, Math.floor((clientY - rect.top) / rect.height * canvas.height));
    const pixel = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(x, y, 1, 1).data;
    if (!pixel || !pixel[3]) return null;
    return { clientX, clientY, x, y, hex: `#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase()}` };
  };
  useEffect(() => {
    const canvas = source.current, context = lens.current?.getContext("2d");
    if (!canvas || !context || !sample) return;
    context.imageSmoothingEnabled = false;
    context.fillStyle = "#24231f";
    context.fillRect(0, 0, 132, 132);
    // Eleven source pixels, each enlarged twelve times. The central cell
    // is exactly the pixel returned by the eyedropper, including at edges.
    context.drawImage(canvas, sample.x - 5, sample.y - 5, 11, 11, 0, 0, 132, 132);
    context.strokeStyle = "#000"; context.lineWidth = 3; context.strokeRect(60, 60, 12, 12);
    context.strokeStyle = "#fff"; context.lineWidth = 1; context.strokeRect(60, 60, 12, 12);
  }, [sample, source]);
  return <div ref={overlay} className="eyedropper-overlay" tabIndex={-1} role="dialog" aria-modal="true" aria-label="Pick a colour from the original photograph"
    onPointerMove={event => setSample(sampleAt(event.clientX, event.clientY))}
    onClick={event => {
      const selected = sampleAt(event.clientX, event.clientY);
      if (selected) onPick(selected.hex);
    }}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
      if (event.key === "Tab") { event.preventDefault(); }
      if (event.key === "Enter" && sample) onPick(sample.hex);
    }}>
    <div className="eyedropper-hint" onClick={event => event.stopPropagation()}>
      Click the original photograph to pick a colour · Esc to return
      <button type="button" onClick={onCancel}>Cancel</button>
    </div>
    {sample && <div className="eyedropper-lens" style={{ left: Math.max(8, Math.min(window.innerWidth - 152, sample.clientX + 24)), top: Math.max(8, Math.min(window.innerHeight - 190, sample.clientY + 24)) }}>
      <canvas ref={lens} width={132} height={132} />
      <div><span style={{ background: sample.hex }} /><code>{sample.hex}</code></div>
    </div>}
  </div>;
}
