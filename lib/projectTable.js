// "My Projects" register: one row per project, columns in the order the
// team's Excel register uses.
import { projectStatusLabel, projectStatusRank, projectProgress } from '@/lib/projectStatus';

const clean = (v) => (typeof v === 'string' ? v.trim() : v);

function contactsFor(contacts, role) {
  const list = (contacts || []).filter((c) => c.contact_role === role);
  const names = list.map((c) => clean(c.company_name) || clean(c.name)).filter(Boolean);
  return [...new Set(names)].join(' | ');
}

// newest quotation first (by quotation date, then when it was added)
export function latestQuotation(quotations) {
  return [...(quotations || [])].sort((a, b) =>
    String(b.quotation_date || '').localeCompare(String(a.quotation_date || ''))
    || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
}

export function toRegisterRow(p) {
  const q = latestQuotation(p.quotations);
  const value = q?.quotation_value !== null && q?.quotation_value !== undefined && q?.quotation_value !== '' ? Number(q.quotation_value) : null;
  return {
    id: p.id,
    project: p,
    date: q?.quotation_date || (p.created_at ? p.created_at.slice(0, 10) : ''),
    dateIsQuote: Boolean(q?.quotation_date),
    quotation_no: clean(q?.quotation_number) || '',
    status: p.status,
    status_label: projectStatusLabel(p.status),
    progress: projectProgress(p.status),
    sales_person: clean(p.sales_person) || '',
    headed_by: clean(p.headed_by) || '',
    name: clean(p.name) || '',
    contractor: contactsFor(p.contacts, 'contractor'),
    client: contactsFor(p.contacts, 'client'),
    consultant: contactsFor(p.contacts, 'consultant'),
    value: Number.isFinite(value) ? value : null,
    brands: String(p.brands_required || '').split(',').map((x) => x.trim()).filter(Boolean).join(' | '),
    note: clean(p.note) || '',
    moreQuotes: Math.max(0, (p.quotations || []).length - 1),
    // reviews: average of everyone's stars (rounded for filtering/sorting)
    rating_avg: (p._ratings || []).length ? (p._ratings.reduce((t, r) => t + r.stars, 0) / p._ratings.length) : null,
    rating_count: (p._ratings || []).length,
    rating: (p._ratings || []).length ? Math.round(p._ratings.reduce((t, r) => t + r.stars, 0) / p._ratings.length) : null,
  };
}

// filter: 'text' = contains, 'select' = pick from the values in use, 'date' = from/to
// pct = share of the table's width (Project Name gets the most); everything
// fits on screen, long text is cut with … (full text on hover)
export const REGISTER_COLUMNS = [
  { key: 'date', label: 'Date', filter: 'date', pct: 7 },
  { key: 'quotation_no', label: 'Quot. No', filter: 'text', pct: 6 },
  { key: 'status', label: 'Status', filter: 'select', pct: 9 },
  { key: 'progress', label: 'Progress', filter: 'select', pct: 6.5 },
  { key: 'sales_person', label: 'Sales', filter: 'select', pct: 7 },
  { key: 'headed_by', label: 'Headed', filter: 'select', pct: 6.5 },
  { key: 'name', label: 'Project Name', filter: 'text', pct: 16 },
  { key: 'contractor', label: 'Contractor', filter: 'select', pct: 8 },
  { key: 'client', label: 'Client', filter: 'select', pct: 8 },
  { key: 'consultant', label: 'Consultant', filter: 'select', pct: 6.5 },
  { key: 'value', label: 'Value (AED)', filter: 'text', pct: 6 },
  { key: 'brands', label: 'Brands', filter: 'select', multi: true, pct: 6 },
  { key: 'rating', label: 'Review', filter: 'select', pct: 7.5 },
];

export const EMPTY = '__empty__';

export function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatValue(v) {
  if (v === null || v === undefined) return '';
  return `AED ${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

// what a cell shows / is searched by
export function cellText(row, key) {
  switch (key) {
    case 'date': return formatDate(row.date);
    case 'status': return row.status_label;
    case 'progress': return `${row.progress}%`;
    case 'rating': return row.rating ? `${row.rating}★` : '';
    case 'value': return formatValue(row.value);
    default: return row[key] ?? '';
  }
}

// dropdown choices for a 'select' column (contacts split on " | ")
export function selectOptions(rows, key) {
  if (key === 'status') {
    const used = new Set(rows.map((r) => r.status));
    return [...used].sort((a, b) => projectStatusRank(a) - projectStatusRank(b))
      .map((v) => ({ value: v, label: projectStatusLabel(v) }));
  }
  if (key === 'rating') {
    return [5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: `${'★'.repeat(n)}${'☆'.repeat(5 - n)}  ${n} star${n > 1 ? 's' : ''}` }));
  }
  if (key === 'progress') {
    const used = [...new Set(rows.map((r) => r.progress))].sort((a, b) => a - b);
    return used.map((v) => ({ value: String(v), label: `${v}%` }));
  }
  const set = new Map();
  rows.forEach((r) => String(r[key] || '').split(' | ').map((s) => s.trim()).filter(Boolean)
    .forEach((s) => set.set(s.toLowerCase(), s)));
  return [...set.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((v) => ({ value: v, label: v }));
}

export function matchesFilter(row, col, f) {
  if (Array.isArray(f)) { // several ticked values: the row needs any one of them
    if (f.length === 0) return true;
    return f.some((one) => matchesFilter(row, col, one));
  }
  if (f === undefined || f === null || f === '' || (typeof f === 'object' && !f.from && !f.to)) return true;
  const raw = row[col.key];
  const isEmpty = raw === null || raw === undefined || raw === '';
  if (col.filter === 'date') {
    if (!row.date) return false;
    const d = row.date.slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  }
  if (col.filter === 'select') {
    if (f === EMPTY) return isEmpty;
    if (isEmpty) return false;
    if (col.key === 'status') return row.status === f;
    if (col.key === 'progress') return String(row.progress) === f;
    if (col.key === 'rating') return String(row.rating) === f;
    return String(raw).split(' | ').some((s) => s.trim().toLowerCase() === f.toLowerCase());
  }
  return cellText(row, col.key).toLowerCase().includes(String(f).trim().toLowerCase());
}

export function compareRows(a, b, key) {
  const pickV = (r) => (key === 'status' ? projectStatusRank(r.status) : key === 'rating' ? r.rating_avg : r[key]);
  const va = pickV(a);
  const vb = pickV(b);
  const ea = va === null || va === undefined || va === '';
  const eb = vb === null || vb === undefined || vb === '';
  if (ea && eb) return 0;
  if (ea) return 1; // blanks always last
  if (eb) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
}
