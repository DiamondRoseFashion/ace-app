'use client';

// A project's costing sheets (R0, R1 …): make a new one (its top details
// fill in from the project), copy one as the next revision, open or
// delete. Admin, plus people listed in costing_access (has_costing_access).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import { calcSheet, money } from '@/lib/costing';
import { fmtDate } from '@/lib/dates';

// "R3" → 3; anything else → -1
const revNo = (r) => { const m = /^R(\d+)$/i.exec(String(r || '').trim()); return m ? Number(m[1]) : -1; };

export default function ProjectCostingPage() {
  const router = useRouter();
  const { id: projectId } = useParams();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [state, setState] = useState('loading'); // loading | ok | denied | missing
  const [project, setProject] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);

  async function loadSheets() {
    const { data, error } = await supabase.from('costing_sheets')
      .select('id, revision, quotation_no, quotation_date, items, discounts_buy, discounts_sell, updated_at, created_at')
      .eq('project_id', projectId).order('created_at', { ascending: true });
    if (error) { setState('missing'); return; }
    setSheets(data || []);
  }

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: ok, error } = await supabase.rpc('has_costing_access');
      if (error) { setState('missing'); return; }
      if (!ok) { setState('denied'); return; }
      const { data: proj } = await supabase.from('projects').select('id, name').eq('id', projectId).maybeSingle();
      setProject(proj);
      await loadSheets();
      setState((s) => (s === 'missing' ? s : 'ok'));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const nextRevision = () => `R${Math.max(-1, ...sheets.map((s) => revNo(s.revision))) + 1}`;

  // the top details a new sheet starts with
  async function projectDetails() {
    const [{ data: proj }, { data: contacts }, { data: quotes }] = await Promise.all([
      supabase.from('projects').select('name').eq('id', projectId).maybeSingle(),
      supabase.from('contacts').select('contact_role, company_name, name, created_at').eq('project_id', projectId).order('created_at'),
      supabase.from('quotations').select('quotation_number, quotation_date, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(1),
    ]);
    const who = (role) => {
      const c = (contacts || []).find((x) => x.contact_role === role && ((x.company_name || '').trim() || (x.name || '').trim()));
      return c ? ((c.company_name || '').trim() || (c.name || '').trim()) : null;
    };
    const q = quotes?.[0];
    return {
      project_name: proj?.name || null,
      client: who('client'),
      contractor: who('contractor') || who('main_contractor'),
      consultant: who('consultant'),
      quotation_no: q?.quotation_number || null,
      quotation_date: q?.quotation_date || null,
    };
  }

  async function createSheet() {
    setErr(''); setBusy(true);
    const details = await projectDetails();
    const { data, error } = await supabase.from('costing_sheets')
      .insert({ project_id: projectId, revision: nextRevision(), ...details })
      .select('id').single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.push(`/costing/${data.id}`);
  }

  async function copySheet(id) {
    setErr(''); setBusy(true);
    const { data: src, error: e1 } = await supabase.from('costing_sheets').select('*').eq('id', id).single();
    if (e1) { setBusy(false); setErr(e1.message); return; }
    const { data, error } = await supabase.from('costing_sheets').insert({
      project_id: projectId,
      revision: nextRevision(),
      project_name: src.project_name, client: src.client, contractor: src.contractor, consultant: src.consultant,
      quotation_no: src.quotation_no, quotation_date: src.quotation_date,
      items: src.items, discounts_buy: src.discounts_buy, discounts_sell: src.discounts_sell, note: src.note,
    }).select('id').single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.push(`/costing/${data.id}`);
  }

  async function deleteSheet(id) {
    setErr(''); setBusy(true);
    const { error } = await supabase.from('costing_sheets').delete().eq('id', id);
    setBusy(false);
    setConfirmDel(null);
    if (error) { setErr(error.message); return; }
    loadSheets();
  }

  if (state !== 'ok') {
    const text = {
      loading: 'Loading…',
      denied: 'Costing sheets are not turned on for your account yet. Please ask your admin.',
      missing: 'Costing sheets need a one-time database update. Please ask your admin to run the "costing sheets" update in Supabase.',
    }[state];
    return (
      <div className="shell">
        <Sidebar active="dashboard" />
        <div className="main"><div className="card"><div className={state === 'loading' ? 'hint' : 'notice err'} style={{ margin: 0 }}>{text}</div></div></div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar active="dashboard" />
      <div className="main">
        <div className="page-header">
          <div>
            <div className="eyebrow">Costing sheets</div>
            <h1 style={{ fontSize: 28, marginTop: 4 }}>{project?.name || 'Project'}</h1>
          </div>
          <div className="header-actions">
            <Link className="btn btn-ghost" href={`/project/${projectId}`} style={{ textDecoration: 'none' }}>← Back to project</Link>
            <button type="button" className="btn btn-primary" onClick={createSheet} disabled={busy}>{busy ? 'Please wait…' : '＋ New costing sheet'}</button>
          </div>
        </div>
        {err && <div className="notice err">{err}</div>}

        <div className="card" style={{ padding: 0 }}>
          {sheets.length === 0 ? (
            <div className="activity-empty" style={{ padding: 28 }}>No costing sheets yet. Press “＋ New costing sheet”: the project, client, contractor, consultant and quotation number fill in by themselves.</div>
          ) : (
            <ul className="drafts-list" style={{ borderTop: 'none' }}>
              {sheets.map((s) => {
                const c = calcSheet(s.items || [], s.discounts_buy || [], s.discounts_sell || []);
                const count = (s.items || []).length;
                return (
                  <li key={s.id} className="drafts-row">
                    <div className="drafts-text">
                      <strong>{s.revision}{s.quotation_no ? ` · ${s.quotation_no}` : ''}</strong>
                      <span>
                        {count} item{count === 1 ? '' : 's'} · Selling gross AED {money(c.grossSell)} · Gross profit AED {money(c.grossProfit)}
                        {' · '}Last saved {fmtDate(s.updated_at.slice(0, 10))}
                      </span>
                    </div>
                    <div className="drafts-actions">
                      {confirmDel === s.id ? (
                        <>
                          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => deleteSheet(s.id)}>Yes, delete {s.revision}</button>
                          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <Link className="btn btn-primary" href={`/costing/${s.id}`}>Open</Link>
                          <Link className="btn btn-ghost" href={`/quotation/${s.id}`}>📄 Quotation</Link>
                          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => copySheet(s.id)} title="Make a copy as the next revision">Copy as {nextRevision()}</button>
                          <button type="button" className="btn btn-ghost danger-text" onClick={() => setConfirmDel(s.id)}>Delete</button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
