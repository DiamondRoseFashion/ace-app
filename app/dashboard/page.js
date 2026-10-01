'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import DownloadBackupButton from '@/components/DownloadBackupButton';
import ViewDataButton from '@/components/ViewDataButton';
import { deleteProject, canDeleteProject } from '@/lib/deleteProject';

const STATUS_LABELS = { design: 'Design', tender: 'Tender', job_in_hand: 'Job in Hand' };

export default function Dashboard() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [me, setMe] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
      .select('*, creator:profiles!created_by(full_name)')
      .order('created_at', { ascending: false });

    if (!err) setProjects(data || []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filteredProjects = projects.filter((p) => {
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.name?.toLowerCase().includes(q) ||
      p.location?.toLowerCase().includes(q) ||
      p.creator?.full_name?.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

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

        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search by name, location, or creator…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 260px', minWidth: 0 }}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All statuses</option>
            <option value="design">Design</option>
            <option value="tender">Tender</option>
            <option value="job_in_hand">Job in Hand</option>
          </select>
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
          ) : filteredProjects.length === 0 ? (
            <div style={{ padding: 32, color: 'var(--muted)', textAlign: 'center' }}>
              No projects match your search.
            </div>
          ) : (
            filteredProjects.map((p) => {
              const canDel = canDeleteProject(p, me);
              const isSel = selected.has(p.id);
              return (
                <div
                  key={p.id}
                  className={`project-row pr-grid pr-clickable${selecting ? ' selecting' : ''}${isSel ? ' pr-selected' : ''}`}
                  role="link"
                  tabIndex={0}
                  onClick={() => (selecting ? canDel && toggle(p.id) : router.push(`/project/${p.id}`))}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/project/${p.id}`); }}
                >
                  {selecting && (
                    <div className="pr-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="row-check"
                        disabled={!canDel}
                        checked={isSel}
                        onChange={() => toggle(p.id)}
                        aria-label={`Select ${p.name}`}
                        title={canDel ? '' : 'Only the creator or a manager can delete this project'}
                      />
                    </div>
                  )}
                  <div className="pr-name" style={{ fontWeight: 600 }}>{p.name}</div>
                  <div><span className={`pill pill-${p.status}`}>{STATUS_LABELS[p.status] || p.status}</span></div>
                  <div className="mono" style={{ fontSize: 13 }}>{p.percent_complete}%</div>
                  <div>{p.location}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{p.creator?.full_name || '—'}</div>
                  <div className="pr-actions">
                    {canDel && !selecting && (
                      <button
                        className="icon-btn danger"
                        aria-label={`Delete ${p.name}`}
                        title="Delete project"
                        onClick={(e) => { e.stopPropagation(); askDelete([p.id]); }}
                      >
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {!loading && projects.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
            Showing {filteredProjects.length} of {projects.length} projects
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
