'use client';

// Pick one project by typing to search. options: [{ id, name, support }]
// ("support" = a project I help on, from the Support page).
import { useEffect, useRef, useState } from 'react';

export default function ProjectPicker({ value, onChange, options = [], placeholder = 'Search projects…' }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc); };
  }, []);

  const chosen = options.find((o) => o.id === value);
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter((o) => words.every((w) => o.name.toLowerCase().includes(w))).slice(0, 200);

  useEffect(() => { setActive(0); }, [text]);
  useEffect(() => {
    const el = listRef.current?.children[active];
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  function pick(o) {
    onChange(o ? o.id : '');
    setText(''); setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (open && shown[active]) pick(shown[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div className="pjp" ref={wrapRef}>
      {chosen && !open ? (
        <div className="pjp-chosen" onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); } }}
          title={chosen.name}>
          <span className="pjp-name">📁 {chosen.name}</span>
          {chosen.support && <span className="pjp-tag">Support</span>}
          <button type="button" className="pjp-x" aria-label="Remove project" onClick={(e) => { e.stopPropagation(); pick(null); }}>✕</button>
        </div>
      ) : (
        <input
          ref={inputRef}
          value={text}
          placeholder={chosen ? chosen.name : placeholder}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Search projects"
        />
      )}
      {open && (
        <div className="pjp-list" ref={listRef} role="listbox">
          {shown.length === 0 ? (
            <div className="pjp-empty">No project matches “{text}”.</div>
          ) : shown.map((o, i) => (
            <div key={o.id} role="option" aria-selected={o.id === value}
              className={`pjp-opt${i === active ? ' on' : ''}${o.id === value ? ' sel' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}>
              <span className="pjp-name">{o.name}</span>
              {o.support && <span className="pjp-tag">Support</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
