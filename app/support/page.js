'use client';

// Support:
//  A) "Projects I support": projects where I'm in "Supported By". I only
//     get Date, Quotation No, Sales Person, Project Name and the
//     Contractor / Client / Consultant company names (that's all the
//     database gives a supporter), and I can add notes.
//  B) "Support on my projects": my own projects that have supporters,
//     with the notes between me and them.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import SupportNotes from '@/components/SupportNotes';
import DateInput from '@/components/DateInput';
import { fmtDate } from '@/lib/dates';
import { latestQuotation } from '@/lib/projectTable';
import { markSupportSeen } from '@/lib/supportAlerts';

const splitNames = (v) => String(v || '').split(' | ').map((s) => s.trim()).filter(Boolean);
const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
const has = (v, f) => !f.trim() || String(v || '').toLowerCase().includes(f.trim().toLowerCase());
const inRange = (d, f) => (!f.from || (d && d >= f.from)) && (!f.to || (d && d <= f.to));
const pick = (v, f) => !f || splitNames(v).includes(f);

// company names per role from a project's contacts
function companiesOf(contacts, role) {
  return uniq((contacts || []).filter((c) => c.contact_role === role)
    .map((c) => (c.company_name || '').trim() || (c.name || '').trim())).join(' | ');
}

const EMPTY_A = { from: '', to: '', qno: '', sales: '', name: '', contractor: '', client: '', consultant: '' };
const EMPTY_B = { from: '', to: '', qno: '', name: '', supporter: '', contractor: '', client: '', consultant: '' };

function Cell({ children, mono, title }) {
  const text = children === null || children === undefined || children === '' ? '—' : children;
  return <td className={mono ? 'mono' : undefined} title={title || (typeof text === 'string' ? text : undefined)}>{text}</td>;
}

function SelectFilter({ value, options, onChange, label }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Filter ${label}`} className={value ? 'on' : ''}>
      <option value="">All</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function TextFilter({ value, onChange, label }) {
  return <input placeholder="Filter…" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Filter ${label}`} className={value ? 'on' : ''} />;
}

function DateFilter({ f, set }) {
  return (
    <div className="sp-dates">
      <DateInput aria-label="Date from" value={f.from} onChange={(e) => set({ ...f, from: e.target.value })} />
      <DateInput aria-label="Date to" value={f.to} onChange={(e) => set({ ...f, to: e.target.value })} />
    </div>
  );
}

export default function Support() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [fa, setFa] = useState(EMPTY_A);
  const [fb, setFb] = useState(EMPTY_B);
  const [mine, setMine] = useState([]);
  const [mineOpenId, setMineOpenId] = useState(null);
  const [newIds, setNewIds] = useState(new Set()); // assigned since I last opened this page

  async function loadMine(uid) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, sales_person, created_at, quotations(quotation_number, quotation_date, created_at), contacts(contact_role, company_name, name), project_supporters(user_id, person:profiles!user_id(full_name)), support_notes(created_at)')
      .eq('created_by', uid);
    if (error) return;
    setMine((data || [])
      .filter((p) => (p.project_supporters || []).length > 0)
      .map((p) => {
        const q = latestQuotation(p.quotations);
        const lastNote = (p.support_notes || []).map((n) => n.created_at).sort().pop() || null;
        return {
          id: p.id, name: p.name,
          date: q?.quotation_date || String(p.created_at || '').slice(0, 10),
          quotation_number: q?.quotation_number || '',
          contractor: companiesOf(p.contacts, 'contractor'),
          client: companiesOf(p.contacts, 'client'),
          consultant: companiesOf(p.contacts, 'consultant'),
          supporters: p.project_supporters.map((s) => s.person?.full_name || 'Someone').join(' | '),
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
      // remember which ones are new (to tag them), then mark them as seen
      const { data: fresh } = await supabase.rpc('my_new_support');
      if (fresh?.length) setNewIds(new Set(fresh.map((x) => x.project_id)));
      await load();
      markSupportSeen(supabase);
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

  // A) Projects I support
  const optsA = {
    sales: uniq(rows.map((r) => r.sales_person)),
    contractor: uniq(rows.flatMap((r) => splitNames(r.contractor))),
    client: uniq(rows.flatMap((r) => splitNames(r.client))),
    consultant: uniq(rows.flatMap((r) => splitNames(r.consultant))),
  };
  const shown = rows.filter((r) => inRange(String(r.project_date || '').slice(0, 10), fa)
    && has(r.quotation_number, fa.qno) && (!fa.sales || r.sales_person === fa.sales) && has(r.project_name, fa.name)
    && pick(r.contractor, fa.contractor) && pick(r.client, fa.client) && pick(r.consultant, fa.consultant));
  const faOn = Object.values(fa).some(Boolean);

  // B) Support on my projects
  const optsB = {
    supporter: uniq(mine.flatMap((r) => splitNames(r.supporters))),
    contractor: uniq(mine.flatMap((r) => splitNames(r.contractor))),
    client: uniq(mine.flatMap((r) => splitNames(r.client))),
    consultant: uniq(mine.flatMap((r) => splitNames(r.consultant))),
  };
  const mineShown = mine.filter((r) => inRange(String(r.date || '').slice(0, 10), fb)
    && has(r.quotation_number, fb.qno) && has(r.name, fb.name) && pick(r.supporters, fb.supporter)
    && pick(r.contractor, fb.contractor) && pick(r.client, fb.client) && pick(r.consultant, fb.consultant));
  const fbOn = Object.values(fb).some(Boolean);

  return (
    <div className="shell">
      <Sidebar active="support" />
      <div className="main">
        <div className="eyebrow">Help</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 6 }}>Support</h1>
        <p style={{ color: 'rgba(255,255,255,.75)', marginTop: 0, marginBottom: 20 }}>
          Projects where you were added under <b>Supported By</b> (open one to add notes), and notes with the supporters of your own projects.
        </p>

        {missing ? (
          <div className="card"><div className="notice err" style={{ margin: 0 }}>Support needs a one-time database update. Please ask your admin.</div></div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <div className="sp-head">
              <strong>Projects I support</strong>
              <span className="sp-count">{faOn ? `${shown.length} of ${rows.length}` : rows.length}</span>
              <span style={{ flex: 1 }} />
              {faOn && <button type="button" className="btn btn-ghost sp-btn" onClick={() => setFa(EMPTY_A)}>Clear filters</button>}
            </div>
            {loading ? (
              <div className="sp-empty">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="sp-empty">No projects yet. When a salesperson adds you under “Supported By”, the project appears here.</div>
            ) : (
              <div className="sp-table-wrap">
                <table className="sp-table">
                  <colgroup>
                    <col style={{ width: '10%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} />
                    <col style={{ width: '22%' }} /><col style={{ width: '14%' }} /><col style={{ width: '12%' }} />
                    <col style={{ width: '15%' }} /><col style={{ width: '9%' }} />
                  </colgroup>
                  <thead>
                    <tr><th>Date</th><th>Quot. No</th><th>Sales Person</th><th>Project Name</th><th>Contractor</th><th>Client</th><th>Consultant</th><th /></tr>
                    <tr className="sp-filters">
                      <th><DateFilter f={fa} set={setFa} /></th>
                      <th><TextFilter value={fa.qno} onChange={(v) => setFa({ ...fa, qno: v })} label="quotation no" /></th>
                      <th><SelectFilter value={fa.sales} options={optsA.sales} onChange={(v) => setFa({ ...fa, sales: v })} label="sales person" /></th>
                      <th><TextFilter value={fa.name} onChange={(v) => setFa({ ...fa, name: v })} label="project name" /></th>
                      <th><SelectFilter value={fa.contractor} options={optsA.contractor} onChange={(v) => setFa({ ...fa, contractor: v })} label="contractor" /></th>
                      <th><SelectFilter value={fa.client} options={optsA.client} onChange={(v) => setFa({ ...fa, client: v })} label="client" /></th>
                      <th><SelectFilter value={fa.consultant} options={optsA.consultant} onChange={(v) => setFa({ ...fa, consultant: v })} label="consultant" /></th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const open = openId === r.project_id;
                      return [
                        <tr key={r.project_id} className={`sp-row${open ? ' open' : ''}`} onClick={() => setOpenId(open ? null : r.project_id)}>
                          <Cell mono>{fmtDate(r.project_date)}</Cell>
                          <Cell mono>{r.quotation_number}</Cell>
                          <Cell>{r.sales_person}</Cell>
                          <td title={r.project_name}>
                            {newIds.has(r.project_id) && <span className="sp-new">NEW</span>}{r.project_name || '—'}
                          </td>
                          <Cell>{r.contractor}</Cell>
                          <Cell>{r.client}</Cell>
                          <Cell>{r.consultant}</Cell>
                          <td style={{ textAlign: 'right' }}>
                            <button type="button" className="btn btn-ghost sp-btn" onClick={(e) => { e.stopPropagation(); setOpenId(open ? null : r.project_id); }}>
                              {open ? 'Close' : 'Notes'}
                            </button>
                          </td>
                        </tr>,
                        open && (
                          <tr key={`${r.project_id}-notes`} className="sp-notes-row">
                            <td colSpan={8}>
                              <SupportNotes projectId={r.project_id} canAdd emptyText="No notes yet. Add the first one above." placeholder="Write what you did to support this project: calls, site visits, documents sent…" />
                            </td>
                          </tr>
                        ),
                      ];
                    })}
                    {shown.length === 0 && <tr><td colSpan={8} className="sp-empty">No projects match these filters.</td></tr>}
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
              <span className="sp-count">{fbOn ? `${mineShown.length} of ${mine.length}` : mine.length}</span>
              <span className="sp-sub">Notes between you and your supporters</span>
              <span style={{ flex: 1 }} />
              {fbOn && <button type="button" className="btn btn-ghost sp-btn" onClick={() => setFb(EMPTY_B)}>Clear filters</button>}
            </div>
            <div className="sp-table-wrap">
              <table className="sp-table">
                <colgroup>
                  <col style={{ width: '10%' }} /><col style={{ width: '9%' }} /><col style={{ width: '20%' }} />
                  <col style={{ width: '13%' }} /><col style={{ width: '11%' }} /><col style={{ width: '13%' }} />
                  <col style={{ width: '14%' }} /><col style={{ width: '9%' }} />
                </colgroup>
                <thead>
                  <tr><th>Date</th><th>Quot. No</th><th>Project Name</th><th>Contractor</th><th>Client</th><th>Consultant</th><th>Supported By</th><th /></tr>
                  <tr className="sp-filters">
                    <th><DateFilter f={fb} set={setFb} /></th>
                    <th><TextFilter value={fb.qno} onChange={(v) => setFb({ ...fb, qno: v })} label="quotation no" /></th>
                    <th><TextFilter value={fb.name} onChange={(v) => setFb({ ...fb, name: v })} label="project name" /></th>
                    <th><SelectFilter value={fb.contractor} options={optsB.contractor} onChange={(v) => setFb({ ...fb, contractor: v })} label="contractor" /></th>
                    <th><SelectFilter value={fb.client} options={optsB.client} onChange={(v) => setFb({ ...fb, client: v })} label="client" /></th>
                    <th><SelectFilter value={fb.consultant} options={optsB.consultant} onChange={(v) => setFb({ ...fb, consultant: v })} label="consultant" /></th>
                    <th><SelectFilter value={fb.supporter} options={optsB.supporter} onChange={(v) => setFb({ ...fb, supporter: v })} label="supported by" /></th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {mineShown.map((r) => {
                    const open = mineOpenId === r.id;
                    return [
                      <tr key={r.id} className={`sp-row${open ? ' open' : ''}`} onClick={() => setMineOpenId(open ? null : r.id)}>
                        <Cell mono>{fmtDate(r.date)}</Cell>
                        <Cell mono>{r.quotation_number}</Cell>
                        <Cell>{r.name}</Cell>
                        <Cell>{r.contractor}</Cell>
                        <Cell>{r.client}</Cell>
                        <Cell>{r.consultant}</Cell>
                        <Cell>{r.supporters.split(' | ').join(', ')}</Cell>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn btn-ghost sp-btn" onClick={(e) => { e.stopPropagation(); setMineOpenId(open ? null : r.id); }}>
                            {open ? 'Close' : `Notes (${r.notes})`}
                          </button>
                        </td>
                      </tr>,
                      open && (
                        <tr key={`${r.id}-notes`} className="sp-notes-row">
                          <td colSpan={8}>
                            <SupportNotes
                              projectId={r.id}
                              canAdd
                              emptyText="No notes yet."
                              placeholder="Write a note for your supporters: instructions, updates, what's needed next…"
                            />
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                  {mineShown.length === 0 && <tr><td colSpan={8} className="sp-empty">No projects match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
