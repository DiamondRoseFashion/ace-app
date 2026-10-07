// One date style for all of ACE: dd/mm/yyyy (UAE style)
const pad = (n) => String(n).padStart(2, '0');

// "2026-10-02" | "2026-10-02T10:00:00Z" | Date → "02/10/2026"
export function fmtDate(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// → "02/10/2026, 2:05 PM"
export function fmtDateTime(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const h = d.getHours();
  return `${fmtDate(d)}, ${h % 12 || 12}:${pad(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
}

// "02/10/2026" → "2026-10-02" (null if not a real date)
export function parseDmy(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const d = +m[1]; const mo = +m[2]; const y = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
