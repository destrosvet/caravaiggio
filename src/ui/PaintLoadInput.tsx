import { useEffect, useState } from "react";
export function PaintLoadInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next) && next >= 10 && next <= 5000) {
      if (next !== value) onChange(next);
      setDraft(String(next));
    } else setDraft(String(value));
  };
  return <label className="simulation-capacity">Paint load length · mm<input type="number" min="10" max="5000" step="1" value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") { event.preventDefault(); setDraft(String(value)); }
    }} /></label>;
}
