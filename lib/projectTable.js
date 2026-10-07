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
function latestQuotation(quotations) {
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
    item: clean(p.item) || '',
    note: clean(p.note) || '',
    moreQuotes: Math.max(0, (p.quotations || []).length - 1),
  };
}

// filter: 'text' = contains, 'select' = pick from the values in use, 'date' = from/to
export const REGISTER_COLUMNS = [
  { key: 'date', label: 'Date', filter: 'date', width: 112 },
  { key: 'quotation_no', label: 'Quotation No', filter: 'text', width: 130 },
  { key: 'status', label: 'Status', filter: 'select', width: 170 },
  { key: 'progress', label: 'Progress', filter: 'select', width: 110 },
  { key: 'sales_person', label: 'Sales Person', filter: 'select', width: 140 },
  { key: 'headed_by', label: 'Headed by', filter: 'select', width: 116 },
  { key: 'name', label: 'Project Name', filter: 'text', width: 220 },
  { key: 'contractor', label: 'Contractor Name', filter: 'select', width: 170 },
  { key: 'client', label: 'Client', filter: 'select', width: 160 },
  { key: 'consultant', label: 'Consultant', filter: 'select', width: 160 },
  { key: 'value', label: 'Value', filter: 'text', width: 130 },
  { key: 'item', label: 'Item', filter: 'text', width: 150 },
  { key: 'note', label: 'Note', filter: 'text', width: 220 },
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
    return String(raw).split(' | ').some((s) => s.trim().toLowerCase() === f.toLowerCase());
  }
  return cellText(row, col.key).toLowerCase().includes(String(f).trim().toLowerCase());
}

export function compareRows(a, b, key) {
  const va = key === 'status' ? projectStatusRank(a.status) : a[key];
  const vb = key === 'status' ? projectStatusRank(b.status) : b[key];
  const ea = va === null || va === undefined || va === '';
  const eb = vb === null || vb === undefined || vb === '';
  if (ea && eb) return 0;
  if (ea) return 1; // blanks always last
  if (eb) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
}
