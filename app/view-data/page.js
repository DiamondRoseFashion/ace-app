'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import { downloadXlsx } from '@/lib/xlsxExport';
import { PROJECT_STATUS_LABELS, projectStatusRank } from '@/lib/projectStatus';
import DateInput from '@/components/DateInput';


const TABS = [
  { key: 'projects', label: 'Projects' },
  { key: 'quotations', label: 'Quotations' },
  { key: 'contacts', label: 'Contacts' },
];

// Dropdown filters per tab (only shown when the column exists and has values)
const FILTERS = {
  projects: [
    { col: 'status', label: 'Status' },
    { col: 'sales_person', label: 'Sales person' },
    { col: 'headed_by', label: 'Headed by' },
    { col: 'quotation_status', label: 'Quotation status' },
    { col: 'brands', label: 'Brands' },
    { col: 'created_by', label: 'Created by' },
  ],
  quotations: [
    { col: 'quotation_status', label: 'Status' },
    { col: 'project', label: 'Project' },
  ],
  contacts: [
    { col: 'role', label: 'Role' },
    { col: 'project', label: 'Project' },
    { col: 'company_name', label: 'Company' },
    { col: 'designation', label: 'Designation' },
  ],
};

// Which date column the From/To range applies to
const DATE_COLS = {
  projects: { col: 'date', label: 'Date' },
  quotations: { col: 'quotation_date', label: 'Quotation date' },
  contacts: { col: 'added_on', label: 'Added' },
};

const STATUS_LABELS = PROJECT_STATUS_LABELS;
const EMPTY = '__empty__';

function display(col, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (col === 'status' && STATUS_LABELS[v]) return STATUS_LABELS[v];
  return String(v);
}

// "29/07/2026" -> 20260729 (sortable number); anything else -> null
function ddmmyyyy(v) {
  const m = typeof v === 'string' && v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : null;
}

// "2026-07-29" (date input) -> 20260729
function isoNum(v) {
  return v ? Number(v.replace(/-/g, '')) : null;
}

function compare(a, b) {
  const empty = (x) => x === null || x === undefined || x === '';
  if (empty(a) && empty(b)) return 0;
  if (empty(a)) return 1;
  if (empty(b)) return -1;
  const da = ddmmyyyy(a); const db = ddmmyyyy(b);
  if (da !== null && db !== null) return da - db;
  const na = Number(a); const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

function emptyFilters() {
  return { search: '', picks: {}, from: '', to: '', sortCol: null, sortDir: 'asc' };
}

function DataTable({ rows, columns, sortCol, sortDir, onSort }) {
  const wrapRef = useRef(null);
  if (!rows || rows.length === 0) {
    return <div style={{ padding: 24, color: 'var(--muted)' }}>No rows match. Try clearing a filter or the search.</div>;
  }
  return (
    <div className="vd-table-wrap" ref={wrapRef} tabIndex={0} role="region" aria-label="Data table — use the arrow keys to scroll">
      <table className="vd-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>
                <button type="button" onClick={() => onSort(col)} aria-label={`Sort by ${col}`}>
                  {col}
                  <span className="vd-sort">{sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {columns.map((col) => (
                <td key={col}>{display(col, row[col])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ViewData() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [allowed, setAllowed] = useState(null);
  const [scope, setScope] = useState('all'); // 'own' = an employee's own projects only
  const [tab, setTab] = useState('projects');
  const [data, setData] = useState({ projects: [], quotations: [], contacts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ projects: emptyFilters(), quotations: emptyFilters(), contacts: emptyFilters() });

  useEffect(() => {
    checkAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAndLoad() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    setAllowed(true);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/view-backup', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (!res.ok) {
      setError('Failed to load data.');
      setLoading(false);
      return;
    }

    const json = await res.json();
    setScope(json.scope === 'own' ? 'own' : 'all');
    setData({ projects: [], quotations: [], contacts: [], ...json });
    setLoading(false);
  }

  const f = filters[tab];
  const setF = (patch) => setFilters((all) => ({ ...all, [tab]: { ...all[tab], ...patch } }));
  const rows = data[tab] || [];

  const columns = useMemo(
    () => Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set())),
    [rows]
  );

  // dropdown options from the data itself
  const filterDefs = useMemo(() => (FILTERS[tab] || [])
    .filter((d) => columns.includes(d.col))
    .map((d) => {
      const values = new Map();
      let hasEmpty = false;
      rows.forEach((r) => {
        const v = r[d.col];
        if (v === null || v === undefined || String(v).trim() === '') { hasEmpty = true; return; }
        // a cell can hold several brands ("Philips, Thorn"): offer each one
        const parts = d.col === 'brands' ? String(v).split(',') : [String(v)];
        parts.map((x) => x.trim()).filter(Boolean).forEach((key) => values.set(key.toLowerCase(), key));
      });
      const options = [...values.values()].sort((a, b) => (d.col === 'status'
        ? projectStatusRank(a) - projectStatusRank(b) // project stages in their real order
        : 0) || a.localeCompare(b, undefined, { sensitivity: 'base' }));
      return { ...d, options, hasEmpty };
    })
    .filter((d) => d.options.length > 0), [tab, rows, columns]);

  const dateDef = DATE_COLS[tab] && columns.includes(DATE_COLS[tab].col) ? DATE_COLS[tab] : null;

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const from = isoNum(f.from);
    const to = isoNum(f.to);
    let out = rows.filter((r) => {
      for (const [col, val] of Object.entries(f.picks)) {
        if (!val) continue;
        const v = r[col];
        const empty = v === null || v === undefined || String(v).trim() === '';
        const cellVals = col === 'brands' ? String(v ?? '').split(',').map((x) => x.trim().toLowerCase()) : [String(v ?? '').trim().toLowerCase()];
        if (val === EMPTY ? !empty : empty || !cellVals.includes(val.toLowerCase())) return false;
      }
      if (dateDef && (from || to)) {
        const d = ddmmyyyy(r[dateDef.col]);
        if (d === null) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      if (q) {
        const hay = Object.entries(r).map(([k, v]) => display(k, v)).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (f.sortCol) {
      const cmp = f.sortCol === 'status' && tab === 'projects'
        ? (a, b) => projectStatusRank(a) - projectStatusRank(b) // by stage, not A–Z
        : compare;
      out = [...out].sort((a, b) => cmp(a[f.sortCol], b[f.sortCol]) * (f.sortDir === 'asc' ? 1 : -1));
    }
    return out;
  }, [rows, f, dateDef, tab]);

  const active = f.search.trim() || Object.values(f.picks).some(Boolean) || f.from || f.to || f.sortCol;

  function onSort(col) {
    if (f.sortCol !== col) setF({ sortCol: col, sortDir: 'asc' });
    else if (f.sortDir === 'asc') setF({ sortDir: 'desc' });
    else setF({ sortCol: null, sortDir: 'asc' });
  }

  return (
    <div className="shell">
      <Sidebar active="dashboard" />
      <div className="main">
        <div className="eyebrow">Live Data</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: scope === 'own' ? 6 : 24 }}>{scope === 'own' ? 'My Projects Data' : 'View Backup Data'}</h1>
        {scope === 'own' && <p style={{ color: 'var(--muted)', marginBottom: 20 }}>Only the projects you created are shown here.</p>}

        {loading ? (
          <div className="card">Loading…</div>
        ) : allowed === false ? (
          <div className="card">You are not authorized to view this data.</div>
        ) : error ? (
          <div className="card error-text">{error}</div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <div style={{ display: 'flex', gap: 4, padding: '16px 20px 0', flexWrap: 'wrap' }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={tab === t.key ? 'btn btn-primary' : 'btn btn-ghost'}
                  onClick={() => setTab(t.key)}
                  style={{ fontSize: 12.5 }}
                >
                  {t.label} ({(data[t.key] || []).length})
                </button>
              ))}
            </div>

            <div className="vd-filters">
              <label className="vd-field vd-search">
                <span>Search</span>
                <input
                  value={f.search}
                  onChange={(e) => setF({ search: e.target.value })}
                  placeholder={`Search all ${tab}…`}
                />
              </label>
              {filterDefs.map((d) => (
                <label className="vd-field" key={d.col}>
                  <span>{d.label}</span>
                  <select
                    value={f.picks[d.col] || ''}
                    onChange={(e) => setF({ picks: { ...f.picks, [d.col]: e.target.value } })}
                  >
                    <option value="">All</option>
                    {d.options.map((o) => <option key={o} value={o}>{display(d.col, o)}</option>)}
                    {d.hasEmpty && <option value={EMPTY}>(blank)</option>}
                  </select>
                </label>
              ))}
              {dateDef && (
                <>
                  <label className="vd-field vd-date">
                    <span>{dateDef.label} from</span>
                    <DateInput value={f.from} onChange={(e) => setF({ from: e.target.value })} />
                  </label>
                  <label className="vd-field vd-date">
                    <span>to</span>
                    <DateInput value={f.to} onChange={(e) => setF({ to: e.target.value })} />
                  </label>
                </>
              )}
            </div>

            <div className="vd-toolbar">
              <span>Showing <strong>{filtered.length}</strong> of {rows.length} {tab}</span>
              {active && (
                <button type="button" className="vd-clear" onClick={() => setFilters((all) => ({ ...all, [tab]: emptyFilters() }))}>
                  Clear filters
                </button>
              )}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={filtered.length === 0}
                onClick={() => downloadXlsx(filtered.map((r) => ({ ...r, status: r.status !== undefined ? display('status', r.status) : r.status })), columns, `ACE-${tab}${active ? '-filtered' : ''}.xlsx`, { sheetName: TABS.find((t) => t.key === tab)?.label })}
                style={{ fontSize: 12.5 }}
              >
                ⬇ Download for Excel
              </button>
            </div>

            <div style={{ padding: '0 20px 20px' }}>
              <DataTable rows={filtered} columns={columns} sortCol={f.sortCol} sortDir={f.sortDir} onSort={onSort} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
