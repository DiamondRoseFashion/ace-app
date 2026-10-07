'use client';

// A date box that always shows dd/mm/yyyy (the browser's own date box
// follows the computer's language and often shows mm/dd/yyyy).
// Type the date (slashes are added for you) or pick it from the 📅 calendar.
// Works like <input type="date">: value and onChange use "yyyy-mm-dd".
import { useEffect, useRef, useState } from 'react';
import { fmtDate, parseDmy } from '@/lib/dates';

function mask(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export default function DateInput({ value, onChange, className = '', style, required, disabled, id, 'aria-label': ariaLabel, min, max }) {
  const [text, setText] = useState(fmtDate(value));
  const [bad, setBad] = useState(false);
  const pickerRef = useRef(null);

  // follow changes made from outside (e.g. form reset)
  useEffect(() => {
    if (parseDmy(text) !== (value || null)) { setText(fmtDate(value)); setBad(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (iso) => onChange?.({ target: { value: iso } });

  function onType(e) {
    const deleting = e.nativeEvent?.inputType?.startsWith('delete');
    const next = deleting ? e.target.value : mask(e.target.value);
    setText(next);
    if (!next) { setBad(false); emit(''); return; }
    const iso = parseDmy(next);
    if (iso) { setBad(false); emit(iso); }
  }

  function onBlur() {
    if (!text) return;
    const iso = parseDmy(text);
    setBad(!iso);
  }

  function openCalendar() {
    const el = pickerRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  }

  return (
    <span className={`date-input${bad ? ' bad' : ''}`} style={style}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={text}
        onChange={onType}
        onBlur={onBlur}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        className={className}
        maxLength={10}
        autoComplete="off"
      />
      <button type="button" className="date-input-cal" onClick={openCalendar} disabled={disabled} aria-label="Open calendar" tabIndex={-1}>📅</button>
      <input
        ref={pickerRef}
        type="date"
        className="date-input-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        min={min}
        max={max}
        onChange={(e) => { setText(fmtDate(e.target.value)); setBad(false); emit(e.target.value); }}
      />
      {bad && <span className="date-input-err">Use dd/mm/yyyy</span>}
    </span>
  );
}
