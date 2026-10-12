'use client';

// A text box with a dropdown of suggestions: pick one, or just type a
// new value. Used for contact Company name and Name.
import { useMemo, useRef, useState } from 'react';

export default function SuggestInput({ value, onChange, options = [], firstOptions = [], firstLabel, placeholder, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);

  const q = String(value || '').trim().toLowerCase();
  const items = useMemo(() => {
    // what's typed right now isn't suggested back to you
    const match = (s) => (!q || s.toLowerCase().includes(q)) && s.toLowerCase() !== q;
    const a = firstOptions.filter(match).map((s) => ({ s, first: true }));
    const b = options.filter(match).map((s) => ({ s, first: false }));
    return [...a, ...b].slice(0, 60);
  }, [q, options, firstOptions]);

  const pick = (s) => { onChange(s); setOpen(false); setActive(-1); };

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); e.preventDefault(); e.stopPropagation(); return; }
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { setActive((i) => Math.min(items.length - 1, i + 1)); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowUp') { setActive((i) => Math.max(0, i - 1)); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Enter' && active >= 0) { pick(items[active].s); e.preventDefault(); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  const firstCount = items.filter((i) => i.first).length;

  return (
    <div className="si-wrap" ref={wrapRef}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) { setOpen(false); setActive(-1); } }}>
      <input
        value={value || ''}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && items.length > 0}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={onKeyDown}
      />
      {(options.length > 0 || firstOptions.length > 0) && (
        <button type="button" className="si-caret" tabIndex={-1} aria-label="Show suggestions"
          onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>▾</button>
      )}
      {open && items.length > 0 && (
        <div className="si-panel" role="listbox">
          {firstCount > 0 && firstLabel && <div className="si-group">{firstLabel}</div>}
          {items.map((it, i) => (
            <div key={`${it.first}-${it.s}`}>
              {i === firstCount && firstCount > 0 && <div className="si-group">Everyone else</div>}
              <button type="button" role="option" aria-selected={i === active}
                className={`si-opt${i === active ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it.s)}>
                {it.s}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
