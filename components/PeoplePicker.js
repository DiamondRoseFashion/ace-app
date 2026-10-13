'use client';

// Pick one or more people from the team (e.g. "Supported By").
// value: array of user ids. people: [{ id, name }].
import { useEffect, useRef, useState } from 'react';

export default function PeoplePicker({ value = [], onChange, people = [], placeholder = 'Choose people', ariaLabel }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc); };
  }, []);

  const chosen = new Set(value);
  const q = text.trim().toLowerCase();
  const options = people.filter((p) => !chosen.has(p.id) && (!q || p.name.toLowerCase().includes(q)));
  const nameOf = (id) => people.find((p) => p.id === id)?.name || 'Someone';

  function pick(p) {
    onChange([...value, p.id]);
    setText(''); setActive(-1); setOpen(true);
    inputRef.current?.focus();
  }
  const remove = (id) => onChange(value.filter((v) => v !== id));

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setOpen(true); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      if (open && options.length) { e.preventDefault(); pick(options[active >= 0 ? active : 0]); }
    } else if (e.key === 'Backspace' && !text && value.length) remove(value[value.length - 1]);
    else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div className="pp" ref={wrapRef}>
      <div className="bp-box" onClick={() => { inputRef.current?.focus(); setOpen(true); }}>
        {value.map((id) => (
          <span className="bp-chip" key={id}>
            {nameOf(id)}
            <button type="button" aria-label={`Remove ${nameOf(id)}`} onClick={(e) => { e.stopPropagation(); remove(id); }}>✕</button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? 'Add another person…' : placeholder}
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel || placeholder}
          autoComplete="off"
        />
      </div>
      {open && (
        <div className="pp-menu" role="listbox">
          {options.map((p, i) => (
            <button type="button" key={p.id} role="option" aria-selected={i === active}
              className={`pp-opt${i === active ? ' active' : ''}`}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              👤 {p.name}
            </button>
          ))}
          {options.length === 0 && (
            <div className="pp-empty">{people.length === 0 ? 'Loading team…' : q ? 'No one matches.' : 'Everyone is selected.'}</div>
          )}
        </div>
      )}
    </div>
  );
}
