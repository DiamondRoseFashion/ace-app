'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import DownloadBackupButton from '@/components/DownloadBackupButton';
import ViewDataButton from '@/components/ViewDataButton';
import { deleteProject, canDeleteProject } from '@/lib/deleteProject';
import useArrowScroll from '@/lib/useArrowScroll';
import {
  REGISTER_COLUMNS, EMPTY, toRegisterRow, cellText, selectOptions, matchesFilter, compareRows, formatDate, formatValue,
} from '@/lib/projectTable';

export default function Dashboard() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const lastSigRef = useRef('');
  const tableRef = useRef(null);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [confirm, setConfirm] = useState(null); // { ids, names, counts }
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }
    const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    setMe({ id: user.id, role: prof?.role || 'employee' });

    // Row-Level Security automatically limits this to
    // whatever rows this signed-in user is allowed to see.
    // (Employees only see their own; owner/admin/manager see everyone's.)
    const { data, error: err } = await supabase
      .from('projects')
      .select('*, creator:profiles!created_by(full_name), quotations(*), contacts(contact_role, company_name, name)')
      .order('created_at', { ascending: false });

    if (!err) {
      const next = data || [];
      const sig = JSON.stringify(next);
      if (sig !== lastSigRef.current) { lastSigRef.current = sig; setProjects(next); } // only redraw on real changes
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Live: when anyone changes a project (status/progress, new, deleted),
  // refresh the list straight away — plus on returning to the tab.
  useEffect(() => {
    let timer = null;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    const channel = supabase
      .channel('dashboard-projects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, refresh)
      .subscribe();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(refresh, 60 * 1000); // safety net
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => projects.map(toRegisterRow), [projects]);
  const options = useMemo(() => Object.fromEntries(
    REGISTER_COLUMNS.filter((c) => c.filter === 'select').map((c) => [c.key, selectOptions(rows, c.key)])
  ), [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      for (const col of REGISTER_COLUMNS) if (!matchesFilter(r, col, filters[col.key])) return false;
      if (q) {
        const hay = REGISTER_COLUMNS.map((c) => cellText(r, c.key)).concat(r.project.location || '').join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return out.sort((a, b) => {
      const c = compareRows(a, b, sort.key);
      const blankA = a[sort.key] === '' || a[sort.key] === null;
      const blankB = b[sort.key] === '' || b[sort.key] === null;
      if (blankA !== blankB) return c; // blanks stay last either way
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, filters, search, sort]);
  const filteredProjects = filteredRows.map((r) => r.project);

  useArrowScroll(tableRef); // ← → ↑ ↓ scroll the table

  const activeFilters = Object.values(filters).filter((f) => f && (typeof f !== 'object' || f.from || f.to)).length + (search.trim() ? 1 : 0);
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  function clickSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' || key === 'value' || key === 'progress' ? 'desc' : 'asc' }));
  }

  const deletable = filteredProjects.filter((p) => canDeleteProject(p, me));

  function toggle(id) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function askDelete(ids) {
    setError('');
    setMessage('');
    const names = projects.filter((p) => ids.includes(p.id)).map((p) => p.name);
    setConfirm({ ids, names, counts: null });
    const count = async (table) => {
      const { count: n } = await supabase.from(table).select('id', { count: 'exact', head: true }).in('project_id', ids);
      return n || 0;
    };
    let files = 0;
    try {
      const lists = await Promise.all(ids.map((id) => supabase.storage.from('project-files').list(id, { limit: 1000 })));
      files = lists.reduce((sum, r) => sum + (r.data || []).filter((f) => f.name).length, 0);
    } catch { /* ignore */ }
    const [contacts, quotations, meetings] = await Promise.all([count('contacts'), count('quotations'), count('meetings')]);
    setConfirm((c) => (c && c.ids === ids ? { ...c, counts: { contacts, quotations, meetings, files } } : c));
  }

  async function doDelete() {
    if (!confirm) return;
    setDeleting(true);
    const failed = [];
    for (const id of confirm.ids) {
      const r = await deleteProject(supabase, id);
      if (!r.ok) failed.push(r.error);
    }
    setDeleting(false);
    const done = confirm.ids.length - failed.length;
    setConfirm(null);
    stopSelecting();
    if (done > 0) setMessage(`${done} project${done === 1 ? '' : 's'} deleted.`);
    if (failed.length) setError(failed[0]);
    load();
  }

  return (
    <div className="shell">
      <Sidebar active="dashboard" />
      <div className="main">
        <div className="page-header">
          <div>
            <div className="eyebrow">Overview</div>
            <h1 style={{ fontSize: 30, marginTop: 4 }}>My Projects</h1>
          </div>
          <div className="header-actions">
            <ViewDataButton />
            <DownloadBackupButton />
            <Link href="/new-project"><button className="btn btn-primary">+ New Project</button></Link>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search every column…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 260px', minWidth: 0 }}
            aria-label="Search projects"
          />
          {activeFilters > 0 && (
            <button className="btn btn-ghost" onClick={() => { setFilters({}); setSearch(''); }}>
              Clear filters ({activeFilters})
            </button>
          )}
          {deletable.length > 0 && !selecting && (
            <button className="btn btn-ghost" onClick={() => setSelecting(true)}>Select</button>
          )}
        </div>

        {selecting && (
          <div className="select-bar">
            <label className="toggle-row" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={deletable.length > 0 && deletable.every((p) => selected.has(p.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(deletable.map((p) => p.id)) : new Set())}
              />
              <span>Select all{deletable.length !== filteredProjects.length ? ' that I can delete' : ''}</span>
            </label>
            <span className="sb-count">{selected.size} selected</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost" onClick={stopSelecting}>Cancel</button>
            <button className="btn btn-danger" disabled={selected.size === 0} onClick={() => askDelete([...selected])}>
              🗑 Delete selected
            </button>
          </div>
        )}

        {message && <div className="notice ok">{message}</div>}
        {error && <div className="notice err">{error}</div>}

        <div className="card" style={{ padding: 0 }}>
          {loading ? (
            <div style={{ padding: 24, color: 'var(--muted)' }}>Loading…</div>
          ) : projects.length === 0 ? (
            <div style={{ padding: 32, color: 'var(--muted)', textAlign: 'center' }}>
              No projects yet. Click &quot;New Project&quot; to add your first one.
            </div>
          ) : (
            <div className="reg-wrap" ref={tableRef} tabIndex={0} role="region" aria-label="Projects table — use the arrow keys to scroll">
              <table className="reg-table">
                <colgroup>
                  {selecting && <col style={{ width: 40 }} />}
                  {REGISTER_COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
                  <col style={{ width: 48 }} />
                </colgroup>
                <thead>
                  <tr>
                    {selecting && <th aria-label="Select" />}
                    {REGISTER_COLUMNS.map((c) => (
                      <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="reg-sort" onClick={() => clickSort(c.key)}>
                          {c.label}
                          <span className="reg-arrow">{sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
                        </button>
                      </th>
                    ))}
                    <th aria-label="Actions" />
                  </tr>
                  <tr className="reg-filters">
                    {selecting && <th />}
                    {REGISTER_COLUMNS.map((c) => (
                      <th key={c.key}>
                        {c.filter === 'select' ? (
                          <select
                            value={filters[c.key] || ''}
                            onChange={(e) => setFilter(c.key, e.target.value)}
                            aria-label={`Filter ${c.label}`}
                            className={filters[c.key] ? 'on' : ''}
                          >
                            <option value="">All</option>
                            {(options[c.key] || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            <option value={EMPTY}>(blank)</option>
                          </select>
                        ) : c.filter === 'date' ? (
                          <div className="reg-dates">
                            <input type="date" aria-label="Date from" value={filters.date?.from || ''} className={filters.date?.from ? 'on' : ''}
                              onChange={(e) => setFilter('date', { ...(filters.date || {}), from: e.target.value })} />
                            <input type="date" aria-label="Date to" value={filters.date?.to || ''} className={filters.date?.to ? 'on' : ''}
                              onChange={(e) => setFilter('date', { ...(filters.date || {}), to: e.target.value })} />
                          </div>
                        ) : (
                          <input
                            type="text"
                            placeholder="Filter…"
                            value={filters[c.key] || ''}
                            onChange={(e) => setFilter(c.key, e.target.value)}
                            aria-label={`Filter ${c.label}`}
                            className={filters[c.key] ? 'on' : ''}
                          />
                        )}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr><td colSpan={REGISTER_COLUMNS.length + (selecting ? 2 : 1)} className="reg-empty">No projects match these filters.</td></tr>
                  ) : filteredRows.map((r) => {
                    const p = r.project;
                    const canDel = canDeleteProject(p, me);
                    const isSel = selected.has(p.id);
                    const open = () => (selecting ? canDel && toggle(p.id) : router.push(`/project/${p.id}`));
                    return (
                      <tr key={p.id} className={`reg-row${isSel ? ' sel' : ''}`} onClick={open}>
                        {selecting && (
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" className="row-check" disabled={!canDel} checked={isSel}
                              onChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} />
                          </td>
                        )}
                        <td className="mono" title={r.dateIsQuote ? 'Quotation date' : 'No quotation yet — date the project was added'}>
                          {formatDate(r.date) || '—'}{!r.dateIsQuote && r.date ? <span className="reg-dim"> *</span> : null}
                        </td>
                        <td className="mono">{r.quotation_no || '—'}{r.moreQuotes > 0 && <span className="reg-dim"> +{r.moreQuotes}</span>}</td>
                        <td>
                          <span className={`pill pill-${r.status}`}>{r.status_label}</span>
                        </td>
                        <td title={`${r.progress}% complete`}>
                          <span className="mono reg-pct">{r.progress}%</span>
                          <div className="reg-prog"><div className={r.progress === 100 ? 'done' : ''} style={{ width: `${r.progress}%` }} /></div>
                        </td>
                        <td>{r.sales_person || '—'}</td>
                        <td>{r.headed_by || '—'}</td>
                        <td>
                          <Link href={`/project/${p.id}`} className="reg-name" onClick={(e) => { if (selecting) e.preventDefault(); e.stopPropagation(); if (selecting && canDel) toggle(p.id); }}>
                            {r.name}
                          </Link>
                        </td>
                        <td>{r.contractor || '—'}</td>
                        <td>{r.client || '—'}</td>
                        <td>{r.consultant || '—'}</td>
                        <td className="mono reg-num">{r.value === null ? '—' : formatValue(r.value)}</td>
                        <td>{r.item || '—'}</td>
                        <td className="reg-note" title={r.note}>{r.note || '—'}</td>
                        <td className="reg-actions">
                          {canDel && !selecting && (
                            <button className="icon-btn danger" aria-label={`Delete ${p.name}`} title="Delete project"
                              onClick={(e) => { e.stopPropagation(); askDelete([p.id]); }}>
                              🗑
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {!loading && projects.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
            Showing {filteredRows.length} of {projects.length} projects · Progress follows the status automatically · Date, Quotation No and Value come from each project&apos;s latest quotation (<span className="reg-dim">*</span> = no quotation yet, date the project was added)
          </div>
        )}
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => !deleting && setConfirm(null)}>
          <div className="card modal" role="alertdialog" aria-modal="true" aria-label="Delete projects" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{confirm.ids.length === 1 ? 'Delete this project?' : `Delete ${confirm.ids.length} projects?`}</h2>
            </div>
            <div className="del-names">
              {confirm.names.slice(0, 6).map((n) => <div key={n}>📁 {n}</div>)}
              {confirm.names.length > 6 && <div>…and {confirm.names.length - 6} more</div>}
            </div>
            <p className="del-warn">
              {confirm.counts ? (
                <>This will also permanently delete {confirm.ids.length === 1 ? 'its' : 'their'} <strong>{confirm.counts.contacts}</strong> contact{confirm.counts.contacts === 1 ? '' : 's'}, <strong>{confirm.counts.quotations}</strong> quotation{confirm.counts.quotations === 1 ? '' : 's'}, <strong>{confirm.counts.meetings}</strong> meeting{confirm.counts.meetings === 1 ? '' : 's'} and <strong>{confirm.counts.files}</strong> uploaded file{confirm.counts.files === 1 ? '' : 's'}.</>
              ) : 'Checking what else will be deleted…'}
              <br />This can&apos;t be undone.
            </p>
            <div className="modal-actions">
              <span style={{ flex: 1 }} />
              <button className="btn btn-ghost" disabled={deleting} onClick={() => setConfirm(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={deleting || !confirm.counts} onClick={doDelete}>
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
