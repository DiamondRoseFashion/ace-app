'use client';

// A costing-sheet dropdown (Make, Model, Code, Make (OEM), OEM Code):
// click the box (or start typing on it) → a list opens with a search
// box at the top. Pick a saved value, or type a new one and press Enter
// ("Add …"). New values are shared with everyone once the sheet is saved.
// The list floats above the page (a scrolled table never cuts it off)
// and follows its box when the page or table scrolls.
import { useEffect, useMemo, useRef, useState } from 'react';

export default function CostingCombo({ value, options = [], onChange, placeholder = 'Select…', ariaLabel, wide = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const seen = new Set();
    const out = [];
    for (const o of options) {
      const k = o.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      if (!s || k.includes(s)) out.push(o);
    }
    out.sort((a, b) => {
      // starts-with matches first, then A–Z
      const as = s && a.toLowerCase().startsWith(s) ? 0 : 1;
      const bs = s && b.toLowerCase().startsWith(s) ? 0 : 1;
      return as - bs || a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    return out.slice(0, 200);
  }, [options, q]);

  const typed = q.trim();
  const canAdd = typed && !options.some((o) => o.toLowerCase() === typed.toLowerCase());
  const rows = canAdd ? [...list, { add: typed }] : list;

  function place() {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.max(r.width, wide ? 320 : 240);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    const below = window.innerHeight - r.bottom;
    const up = below < 300 && r.top > below;
    setPos(up ? { left, width, bottom: window.innerHeight - r.top + 4 } : { left, width, top: r.bottom + 4 });
  }

  function openPanel(start = '') {
    setQ(start);
    setActive(0);
    place();
    setOpen(true);
  }

  function close(focusBack = true) {
    setOpen(false);
    if (focusBack) btnRef.current?.focus();
  }

  function pick(v) {
    onChange(v);
    close();
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus({ preventScroll: true });
    const onDoc = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close(false);
    };
    // the page or table scrolled: keep the list next to its box
    const onMove = (e) => { if (!panelRef.current?.contains(e.target)) place(); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onSearchKey(e) {
    if (e.key === 'ArrowDown') { setActive((i) => Math.min(rows.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const r = rows[active];
      if (r) pick(typeof r === 'string' ? r : r.add);
      else if (typed) pick(typed);
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') { close(false); }
  }

  function onBtnKey(e) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); openPanel(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (value) { e.preventDefault(); onChange(''); } }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); openPanel(e.key); }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`cc-btn${value ? '' : ' empty'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={value || ''}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onBtnKey}
      >
        <span className="cc-val">{value || placeholder}</span>
        <span className="cc-caret" aria-hidden="true">▾</span>
      </button>
      {open && pos && (
        <div ref={panelRef} className="cc-panel" style={pos} role="dialog" aria-label={ariaLabel}>
          <input
            ref={searchRef}
            className="cc-search"
            placeholder="🔍 Search or type a new one…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onSearchKey}
            aria-label={`Search ${ariaLabel || ''}`}
          />
          <ul className="cc-list" role="listbox">
            {rows.length === 0 && <li className="cc-empty">Nothing saved yet. Type a value and press Enter.</li>}
            {rows.map((r, i) => (
              <li
                key={typeof r === 'string' ? r : `add-${r.add}`}
                role="option"
                aria-selected={i === active}
                className={`cc-opt${i === active ? ' on' : ''}${typeof r === 'string' && r.toLowerCase() === String(value || '').toLowerCase() ? ' cur' : ''}${typeof r === 'string' ? '' : ' add'}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(typeof r === 'string' ? r : r.add); }}
              >
                {typeof r === 'string' ? r : <>＋ Add “{r.add}”</>}
              </li>
            ))}
          </ul>
          {value && (
            <button type="button" className="cc-clear" onMouseDown={(e) => { e.preventDefault(); pick(''); }}>Clear</button>
          )}
        </div>
      )}
    </>
  );
}
