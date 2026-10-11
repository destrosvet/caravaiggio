import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
type Props = { canvasRef: RefObject<HTMLCanvasElement | null>; width: number; height: number; headerAction?: ReactNode };
export function SimulationViewport({ canvasRef, width, height, headerAction }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomValue = useRef(1);
  const [fitSize, setFitSize] = useState({ width: 760, height: 520 });
  const zoomPreview = useCallback((requested: number, clientX?: number, clientY?: number) => {
    const element = viewport.current, next = Math.max(.5, Math.min(4, requested));
    if (!element || next === zoomValue.current) return;
    const bounds = element.getBoundingClientRect();
    const x = (clientX ?? bounds.left + bounds.width / 2) - bounds.left;
    const y = (clientY ?? bounds.top + bounds.height / 2) - bounds.top;
    const ratio = next / zoomValue.current;
    const left = (element.scrollLeft + x) * ratio - x, top = (element.scrollTop + y) * ratio - y;
    zoomValue.current = next; setZoom(next);
    requestAnimationFrame(() => { element.scrollLeft = left; element.scrollTop = top; });
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const fit = () => {
      const scale = Math.min(Math.max(1, element.clientWidth - 36) / width, Math.max(1, element.clientHeight - 36) / height);
      setFitSize({ width: width * scale, height: height * scale });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element); fit();
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomPreview(zoomValue.current * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener("wheel", wheel); };
  }, [width, height, zoomPreview]);
  const stopPan = () => { pan.current = null; viewport.current?.classList.remove("panning"); };
  return <div className="simulation-viewer">
    <div className="simulation-controls simulation-zoom-controls">
      <button type="button" aria-label="Zoom out simulation" onClick={() => zoomPreview(zoomValue.current - .25)}>−</button>
      <input aria-label="Simulation preview zoom" type="range" min="50" max="400" step="5" value={zoom * 100} onChange={event => zoomPreview(Number(event.target.value) / 100)} />
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in simulation" onClick={() => zoomPreview(zoomValue.current + .25)}>+</button>
      <button type="button" onClick={() => { zoomValue.current = 1; setZoom(1); if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0; } }}>Fit to view</button>
      <span className="workspace-caption">Wheel to zoom · Drag to pan</span>
      {headerAction}
    </div>
    <div ref={viewport} className="stroke-viewport simulation-viewport" aria-label="Simulation zoom and pan viewport"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); const element = event.currentTarget; pan.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop }; element.setPointerCapture(event.pointerId); element.classList.add("panning"); }}
      onPointerMove={event => { if (!pan.current) return; event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x); event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y); }}
      onPointerUp={stopPan} onPointerCancel={stopPan} onLostPointerCapture={stopPan}>
      <div className="stroke-canvas-surface" style={{ width: fitSize.width * zoom, height: fitSize.height * zoom }}>
        <canvas ref={canvasRef} aria-label="Animated painting and brush movement" style={{ width: fitSize.width * zoom, height: fitSize.height * zoom, maxWidth: "none", maxHeight: "none" }} />
      </div>
    </div>
  </div>;
}
