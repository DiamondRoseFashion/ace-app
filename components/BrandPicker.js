'use client';

// "Brands Required": pick one or more brands from the shared list, or
// type a new one — a new brand is added to the shared list, so everyone
// else can pick it too. Value is a string like "Philips, Schréder".
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';

export function splitBrands(value) {
  return String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
}
const joinBrands = (list) => list.join(', ');
const norm = (s) => s.trim().toLowerCase();

export default function BrandPicker({ value, onChange, id }) {
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const selected = splitBrands(value);
  const [all, setAll] = useState([]);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  async function loadBrands() {
    const { data, error: err } = await supabase.from('brands').select('name').order('name');
    if (!err) setAll((data || []).map((b) => b.name));
  }

  useEffect(() => { loadBrands(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc); };
  }, []);

  const typed = text.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const chosen = new Set(selected.map(norm));
  const matches = all.filter((b) => !chosen.has(norm(b)) && (!typed || norm(b).includes(norm(typed)))).slice(0, 12);
  const exists = typed && (all.some((b) => norm(b) === norm(typed)) || chosen.has(norm(typed)));
  const options = [
    ...matches.map((b) => ({ type: 'brand', label: b })),
    ...(typed && !exists ? [{ type: 'new', label: typed }] : []),
  ];

  function pick(label) {
    if (!chosen.has(norm(label))) onChange(joinBrands([...selected, label]));
    setText('');
    setActive(-1);
    setOpen(true);
    inputRef.current?.focus();
  }

  async function addNew(label) {
    setError('');
    setAdding(true);
    const { error: err } = await supabase.from('brands').insert({ name: label });
    setAdding(false);
    // already added by someone else a moment ago is fine
    if (err && !/duplicate|unique/i.test(err.message)) {
      setError(/relation|schema cache|does not exist/i.test(err.message)
        ? 'The shared brand list needs a one-time database update (ask your admin). The brand is still saved on this project.'
        : `Couldn't add the brand to the shared list: ${err.message}`);
    }
    await loadBrands();
    pick(label);
  }

  function choose(o) {
    if (o.type === 'new') addNew(o.label);
    else pick(o.label);
  }

  function remove(label) {
    onChange(joinBrands(selected.filter((b) => norm(b) !== norm(label))));
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' || e.key === ',') {
      if (!typed && e.key === 'Enter') return;
      e.preventDefault();
      if (active >= 0 && options[active]) choose(options[active]);
      else if (typed) {
        const existing = all.find((b) => norm(b) === norm(typed));
        if (existing) pick(existing); else addNew(typed);
      }
    } else if (e.key === 'Backspace' && !text && selected.length) {
      remove(selected[selected.length - 1]);
    } else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div className="pp brand-picker" ref={wrapRef}>
      <div className="bp-box" onClick={() => { inputRef.current?.focus(); setOpen(true); }}>
        {selected.map((b) => (
          <span className="bp-chip" key={b}>
            {b}
            <button type="button" aria-label={`Remove ${b}`} onClick={(e) => { e.stopPropagation(); remove(b); }}>✕</button>
          </span>
        ))}
        <input
          id={id}
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => { setOpen(true); loadBrands(); }}
          onKeyDown={onKeyDown}
          placeholder={selected.length ? 'Add another brand…' : 'Choose brands or type a new one'}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label="Brands required"
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="pp-menu" role="listbox">
          {options.map((o, i) => (
            <button
              type="button"
              key={`${o.type}-${o.label}`}
              role="option"
              aria-selected={i === active}
              className={`pp-opt${i === active ? ' active' : ''}${o.type === 'new' ? ' pp-new' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              disabled={adding}
            >
              {o.type === 'new'
                ? <>＋ Add “{o.label}”<span className="pp-sub">new brand: everyone will be able to choose it</span></>
                : <>🏷️ {o.label}</>}
            </button>
          ))}
          {options.length === 0 && (
            <div className="pp-empty">
              {all.length === 0 && !typed ? 'No brands yet. Type a brand name and press Enter to add it.'
                : typed ? 'Already added.' : 'All brands are selected. Type to add a new one.'}
            </div>
          )}
        </div>
      )}
      {error && <div className="error-text" style={{ marginTop: 6 }}>{error}</div>}
    </div>
  );
}
