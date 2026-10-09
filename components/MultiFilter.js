'use client';

// A filter box where several values can be ticked at once
// (used for Brands on My Projects). value = array of picked values.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export default function MultiFilter({ options, value = [], onChange, emptyValue, label }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const picked = new Set(value);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, 240);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom;
    setPos(below > 260 || below > r.top
      ? { left, top: r.bottom + 4, width, maxHeight: Math.min(320, below - 12) }
      : { left, bottom: window.innerHeight - r.top + 4, width, maxHeight: Math.min(320, r.top - 12) });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const key = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    const move = () => place();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', move);
    window.addEventListener('scroll', move, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', move);
      window.removeEventListener('scroll', move, true);
    };
  }, [open]);

  const toggle = (v) => {
    const next = new Set(picked);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange([...next]);
  };

  const all = [...options, ...(emptyValue ? [{ value: emptyValue, label: '(blank)' }] : [])];
  const shown = q.trim() ? all.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase())) : all;
  const summary = value.length === 0 ? 'All'
    : value.length === 1 ? (all.find((o) => o.value === value[0])?.label || value[0])
      : `${value.length} brands`;

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`mf-btn${value.length ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Filter ${label}`}
        title={value.length ? value.map((v) => all.find((o) => o.value === v)?.label || v).join(', ') : `All ${label.toLowerCase()}`}
      >
        <span>{summary}</span><span className="mf-caret" aria-hidden>▾</span>
      </button>
      {open && pos && (
        <div className="mf-panel" ref={panelRef} style={pos} role="listbox" aria-multiselectable="true" aria-label={label}>
          {all.length > 8 && (
            <input className="mf-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          )}
          <div className="mf-list">
            {shown.length === 0 && <div className="mf-none">No match</div>}
            {shown.map((o) => (
              <label key={o.value} className="mf-opt">
                <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          <div className="mf-foot">
            <span className="mf-hint">Shows projects with any ticked brand</span>
            {value.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}
          </div>
        </div>
      )}
    </>
  );
}
