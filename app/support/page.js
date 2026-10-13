'use client';

// Support: projects where I'm in "Supported By". For each one I only
// see Date, Quotation No, Sales Person and Project Name (that's all the
// database gives a supporter), and I can add support notes.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import SupportNotes from '@/components/SupportNotes';
import { fmtDate } from '@/lib/dates';
import { latestQuotation } from '@/lib/projectTable';

export default function Support() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState('');
  // my own projects that have supporters (what they wrote, read-only)
  const [mine, setMine] = useState([]);
  const [mineOpenId, setMineOpenId] = useState(null);

  async function loadMine(uid) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, sales_person, created_at, quotations(quotation_number, quotation_date, created_at), project_supporters(user_id, person:profiles!user_id(full_name)), support_notes(created_at)')
      .eq('created_by', uid);
    if (error) return;
    setMine((data || [])
      .filter((p) => (p.project_supporters || []).length > 0)
      .map((p) => {
        const q = latestQuotation(p.quotations);
        const lastNote = (p.support_notes || []).map((n) => n.created_at).sort().pop() || null;
        return {
          id: p.id, name: p.name, sales_person: p.sales_person,
          date: q?.quotation_date || String(p.created_at || '').slice(0, 10),
          quotation_number: q?.quotation_number || '',
          supporters: p.project_supporters.map((s) => s.person?.full_name || 'Someone').join(', '),
          notes: (p.support_notes || []).length,
          lastNote,
        };
      })
      .sort((a, b) => String(b.lastNote || b.date).localeCompare(String(a.lastNote || a.date))));
  }

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) loadMine(user.id);
    const { data, error } = await supabase.rpc('my_support_projects');
    if (error) setMissing(/function|does not exist|schema cache/i.test(error.message));
    else { setMissing(false); setRows(data || []); }
    setLoading(false);
  }

  useEffect(() => {
    let ch = null;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      await load();
      // live: a project assigned to me (or taken off) shows up straight away
      ch = supabase
        .channel(`my-support-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'project_supporters', filter: `user_id=eq.${user.id}` }, () => load())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_notes' }, () => loadMine(user.id))
        .subscribe();
    })();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { if (ch) supabase.removeChannel(ch); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = search.trim().toLowerCase();
  const shown = q
    ? rows.filter((r) => [fmtDate(r.project_date), r.quotation_number, r.sales_person, r.project_name].join(' ').toLowerCase().includes(q))
    : rows;

  return (
    <div className="shell">
      <Sidebar active="support" />
      <div className="main">
        <div className="eyebrow">Help</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 6 }}>Support</h1>
        <p style={{ color: 'rgba(255,255,255,.75)', marginTop: 0, marginBottom: 20 }}>
          Projects where you were added under <b>Supported By</b> (open one to add notes), and what supporters wrote on your own projects.
        </p>

        {missing ? (
          <div className="card"><div className="notice err" style={{ margin: 0 }}>Support needs a one-time database update. Please ask your admin.</div></div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <div className="sp-head">
              <strong>Projects I support</strong>
              <span className="sp-count">{rows.length}</span>
              <span style={{ flex: 1 }} />
              {rows.length > 5 && (
                <input className="sp-search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search supported projects" />
              )}
            </div>
            {loading ? (
              <div className="sp-empty">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="sp-empty">No projects yet. When a salesperson adds you under “Supported By”, the project appears here.</div>
            ) : (
              <div className="sp-table-wrap">
                <table className="sp-table">
                  <thead>
                    <tr><th style={{ width: '14%' }}>Date</th><th style={{ width: '18%' }}>Quotation No</th><th style={{ width: '18%' }}>Sales Person</th><th>Project Name</th><th style={{ width: 120 }} /></tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const open = openId === r.project_id;
                      return [
                        <tr key={r.project_id} className={`sp-row${open ? ' open' : ''}`} onClick={() => setOpenId(open ? null : r.project_id)}>
                          <td className="mono">{fmtDate(r.project_date) || '—'}</td>
                          <td className="mono">{r.quotation_number || '—'}</td>
                          <td>{r.sales_person || '—'}</td>
                          <td className="sp-name" title={r.project_name}>{r.project_name}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="btn btn-ghost sp-btn" onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : r.project_id); }}>
                              {open ? 'Close' : 'Notes'}
                            </button>
                          </td>
                        </tr>,
                        open && (
                          <tr key={`${r.project_id}-notes`} className="sp-notes-row">
                            <td colSpan={5}>
                              <SupportNotes projectId={r.project_id} canAdd emptyText="No notes yet. Add the first one above." />
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                    {shown.length === 0 && <tr><td colSpan={5} className="sp-empty">No projects match.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {!missing && mine.length > 0 && (
          <div className="card" style={{ padding: 0, marginTop: 24 }}>
            <div className="sp-head">
              <strong>Support on my projects</strong>
              <span className="sp-count">{mine.length}</span>
              <span className="sp-sub">What your supporters wrote on your projects</span>
            </div>
            <div className="sp-table-wrap">
              <table className="sp-table">
                <thead>
                  <tr><th style={{ width: '13%' }}>Date</th><th style={{ width: '16%' }}>Quotation No</th><th>Project Name</th><th style={{ width: '22%' }}>Supported By</th><th style={{ width: 140 }} /></tr>
                </thead>
                <tbody>
                  {mine.map((r) => {
                    const open = mineOpenId === r.id;
                    return [
                      <tr key={r.id} className={`sp-row${open ? ' open' : ''}`} onClick={() => setMineOpenId(open ? null : r.id)}>
                        <td className="mono">{fmtDate(r.date) || '—'}</td>
                        <td className="mono">{r.quotation_number || '—'}</td>
                        <td className="sp-name" title={r.name}>{r.name}</td>
                        <td title={r.supporters}>{r.supporters}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn btn-ghost sp-btn" onClick={(e) => { e.stopPropagation(); setMineOpenId(open ? null : r.id); }}>
                            {open ? 'Close' : `Notes (${r.notes})`}
                          </button>
                        </td>
                      </tr>,
                      open && (
                        <tr key={`${r.id}-notes`} className="sp-notes-row">
                          <td colSpan={5}>
                            <SupportNotes projectId={r.id} emptyText="Your supporters haven't added any notes yet." />
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
