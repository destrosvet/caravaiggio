import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

type Paint = Readonly<{ id: string; name: string; hex: string; skipPainting: boolean }>;
export function ShadowPaintSelect({ paints, value, onChange }: { paints: readonly Paint[]; value: string; onChange: (value: string) => void }) {
  const id = useId(), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const options = [
    { id: "auto", name: "Automatic · suitable darker paint", hex: "" },
    ...(!paints.some(p => p.id === value && !p.skipPainting) && value !== "auto" ? [{ id: value, name: "Unavailable paint · choose another", hex: "" }] : []),
    ...paints.filter(p => !p.skipPainting),
  ];
  const selected = options.find(p => p.id === value) ?? options[0];
  const current = Math.min(active, options.length - 1);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (open) document.getElementById(`${id}-option-${current}`)?.scrollIntoView?.({ block: "nearest" }); }, [open, current, id]);
  const choose = (paintId: string) => { onChange(paintId); setOpen(false); trigger.current?.focus(); };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = options.findIndex(p => p.id === value);
      setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : !open ? Math.max(0, index) : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      setOpen(true);
    } else if (open && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); choose(options[current].id); }
    else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
    else if (event.key === "Tab") setOpen(false);
  };
  const swatch = (paint: typeof selected) => <span aria-hidden="true" className={`shadow-paint-swatch${paint.id === "auto" ? " automatic" : !paint.hex ? " unavailable" : ""}`} style={paint.hex ? { backgroundColor: paint.hex } : undefined}>{paint.id === "auto" ? "A" : ""}</span>;
  return <div className="shadow-paint-select" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <label htmlFor={`${id}-trigger`}>Shadow paint</label>
    <button type="button" id={`${id}-trigger`} ref={trigger} className="shadow-paint-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open ? `${id}-option-${current}` : undefined}
      onKeyDown={keyDown} onClick={() => { setActive(Math.max(0, options.findIndex(p => p.id === value))); setOpen(v => !v); }}>
      {swatch(selected)}<span className="shadow-paint-name">{selected.name}{selected.hex && <small>{selected.hex}</small>}</span><span aria-hidden="true">▾</span>
    </button>
    {open && <div id={`${id}-list`} role="listbox" aria-label="Shadow paint colours" className="shadow-paint-options">
      {options.map((paint, index) => <button type="button" key={paint.id} id={`${id}-option-${index}`} role="option" aria-selected={paint.id === value} tabIndex={-1} className={index === current ? "active" : ""}
        onPointerMove={() => setActive(index)} onClick={() => choose(paint.id)}>
        {swatch(paint)}<span className="shadow-paint-name">{paint.name}{paint.hex && <small>{paint.hex}</small>}</span>{paint.id === value && <span aria-hidden="true">✓</span>}
      </button>)}
    </div>}
  </div>;
}
