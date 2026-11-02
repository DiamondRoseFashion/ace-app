'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import { HEADED_BY_OPTIONS, SALES_PEOPLE } from '@/lib/projectFields';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, DEFAULT_PROJECT_STATUS } from '@/lib/projectStatus';
import DateInput from '@/components/DateInput';
import BrandPicker from '@/components/BrandPicker';
import PeoplePicker from '@/components/PeoplePicker';
import { useTeam } from '@/lib/team';
import { notifySupporters } from '@/lib/supportAlerts';
import SuggestInput from '@/components/SuggestInput';
import { useContactNames, companyOptions, personOptions, savedPerson, fillFromSaved, designationOptions } from '@/lib/contactNames';

const CONTACT_ROLES = [
  { key: 'contractor', label: 'Contractor' },
  { key: 'client', label: 'Client' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'main_contractor', label: 'Main Contractor' },
];

function emptyContact() {
  return { company_name: '', name: '', designation: '', tel: '', mobile: '', email: '' };
}


export default function NewProject() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [project, setProject] = useState({ name: '', status: DEFAULT_PROJECT_STATUS, location: '', brands_required: '', sales_person: '', headed_by: '', note: '' });

  // Supported By: people (user ids) who support this project
  const [supporters, setSupporters] = useState([]);
  const team = useTeam(supabase);
  const [myUserId, setMyUserId] = useState(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyUserId(data?.user?.id || null)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ---------- drafts ----------
  // "Save as draft" keeps the form in ACE (table project_drafts, only you
  // see it); /new-project?draft=<id> opens one again. Auto-keep also holds
  // what you type on this device, so a closed tab doesn't lose it.
  const [draftId, setDraftId] = useState(null);
  const [draftMsg, setDraftMsg] = useState(null); // { ok, text }
  const [draftSaving, setDraftSaving] = useState(false);
  const [kept, setKept] = useState(null); // unsaved work found on this device
  const keepReady = useRef(false); // don't overwrite kept work until the person decides

  // one array of contacts per role
  const [contacts, setContacts] = useState({
    contractor: [emptyContact()],
    client: [emptyContact()],
    consultant: [],
    main_contractor: [],
  });

const [quotation, setQuotation] = useState({
  quotation_number: '',
  quotation_date: '',
  target_submission_date: '',
  quotation_value: '',
  issued_by: '',
  opportunity_ref: '',
  customer_name: '',
  client: '',
  consultant: '',
  item: '',
  remarks: '',
  contractor: '',
}); 

  const keepKey = myUserId ? `ace-new-project-${myUserId}` : null;
  const hasContent = () => Object.entries(project).some(([k, v]) => k !== 'status' && String(v || '').trim())
    || supporters.length > 0
    || Object.values(contacts).some((list) => list.some((c) => Object.values(c).some((v) => String(v || '').trim())));

  function fillForm(data) {
    if (data.project) setProject((p) => ({ ...p, ...data.project }));
    if (data.contacts) setContacts((c) => ({ ...c, ...data.contacts }));
    if (Array.isArray(data.supporters)) setSupporters(data.supporters);
  }

  // open a draft (?draft=<id>), or offer work kept on this device
  useEffect(() => {
    if (!myUserId) return;
    const id = new URLSearchParams(window.location.search).get('draft');
    (async () => {
      if (id) {
        const { data, error: dErr } = await supabase.from('project_drafts').select('id, data').eq('id', id).maybeSingle();
        if (data) { fillForm(data.data || {}); setDraftId(data.id); setDraftMsg({ ok: true, text: 'Draft opened. Finish it with "Save & Continue", or keep it with "Save as draft".' }); }
        else setDraftMsg({ ok: false, text: dErr ? friendlyDraftError(dErr.message) : 'That draft was not found. It may have been finished or deleted.' });
        keepReady.current = true;
        return;
      }
      try {
        const k = JSON.parse(window.localStorage.getItem(`ace-new-project-${myUserId}`) || 'null');
        if (k?.data) { setKept(k); return; }
      } catch { /* ignore */ }
      keepReady.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId]);

  // auto-keep: hold the form on this device while you type
  useEffect(() => {
    if (!keepKey || !keepReady.current || step !== 1) return;
    const t = setTimeout(() => {
      try {
        if (hasContent()) window.localStorage.setItem(keepKey, JSON.stringify({ data: { project, contacts, supporters }, draftId, at: Date.now() }));
        else window.localStorage.removeItem(keepKey);
      } catch { /* ignore */ }
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, contacts, supporters, draftId, step, keepKey]);

  function clearKept() {
    try { if (keepKey) window.localStorage.removeItem(keepKey); } catch { /* ignore */ }
  }

  function continueKept() {
    fillForm(kept.data);
    if (kept.draftId) setDraftId(kept.draftId);
    setKept(null);
    keepReady.current = true;
  }

  function discardKept() {
    clearKept();
    setKept(null);
    keepReady.current = true;
  }

  async function saveDraft() {
    setDraftMsg(null); setError('');
    if (!hasContent()) { setDraftMsg({ ok: false, text: 'Type something first, then save it as a draft.' }); return; }
    setDraftSaving(true);
    const row = { name: project.name.trim() || null, data: { project, contacts, supporters } };
    let res = draftId
      ? await supabase.from('project_drafts').update(row).eq('id', draftId).select('id').maybeSingle()
      : await supabase.from('project_drafts').insert(row).select('id').maybeSingle();
    if (!res.error && !res.data && draftId) {
      // the draft was deleted meanwhile (e.g. on another device): save a new one
      res = await supabase.from('project_drafts').insert(row).select('id').maybeSingle();
    }
    setDraftSaving(false);
    if (res.error) { setDraftMsg({ ok: false, text: friendlyDraftError(res.error.message) }); return; }
    setDraftId(res.data.id);
    clearKept();
    setDraftMsg({ ok: true, text: 'Draft saved ✓ Only you can see it. Find it on My Projects → Drafts.' });
  }

  function addContact(roleKey) {
    setContacts((c) => ({ ...c, [roleKey]: [...c[roleKey], emptyContact()] }));
  }
  function removeContact(roleKey, idx) {
    setContacts((c) => ({ ...c, [roleKey]: c[roleKey].filter((_, i) => i !== idx) }));
  }
  // shared Company / Name suggestions, plus what's typed on this form
  const contactNames = useContactNames(supabase);
  const typedCompanies = (role) => (contacts[role] || []).map((x) => x.company_name).filter(Boolean);
  const typedPeople = (role) => (contacts[role] || []).map((x) => x.name).filter(Boolean);

  // picking a saved person fills their designation / tel / mobile / email
  function fillSavedPerson(roleKey, idx, name) {
    setContacts((c) => {
      const list = [...c[roleKey]];
      const saved = savedPerson(contactNames, roleKey, list[idx]?.company_name, name);
      list[idx] = fillFromSaved({ ...list[idx], name }, saved);
      return { ...c, [roleKey]: list };
    });
  }

  function updateContact(roleKey, idx, field, value) {
    setContacts((c) => {
      const list = [...c[roleKey]];
      list[idx] = { ...list[idx], [field]: value };
      return { ...c, [roleKey]: list };
    });
  }

  // empty boxes are saved as "nothing", never as "" (the database rejects "" for dates and numbers)
  function clean(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'string' && v.trim() === '' ? null : v;
    return out;
  }
  const isBlank = (obj) => Object.values(obj).every((v) => v === null || v === undefined || String(v).trim() === '');

  async function saveStep1() {
    setError(''); setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('projects')
      .insert({ ...project, created_by: user.id })
      .select()
      .single();

    if (error) { setError(error.message); setSaving(false); return; }

    // flatten all non-empty contacts across all roles into insert rows
    const rows = [];
    for (const roleKey of Object.keys(contacts)) {
      for (const c of contacts[roleKey]) {
        if (c.name.trim() || (c.company_name || '').trim()) rows.push({ ...c, project_id: data.id, contact_role: roleKey });
      }
    }
    if (rows.length > 0) {
      const { error: contactError } = await supabase.from('contacts').insert(rows);
      if (contactError) { setError(contactError.message); setSaving(false); return; }
    }

    // Supported By: these people see the project on their Support page
    if (supporters.length > 0) {
      const { error: supErr } = await supabase.from('project_supporters')
        .insert(supporters.map((uid) => ({ project_id: data.id, user_id: uid })));
      if (supErr) {
        setError(/relation|schema cache|does not exist/i.test(supErr.message)
          ? 'The project was saved, but "Supported By" needs a one-time database update (ask your admin).'
          : `The project was saved, but "Supported By" couldn't be saved: ${supErr.message}`);
      } else {
        notifySupporters(supabase, data.id, supporters); // phone/computer notification
      }
    }

    // it's a real project now: the draft and the kept copy aren't needed
    if (draftId) await supabase.from('project_drafts').delete().eq('id', draftId);
    clearKept();
    setDraftId(null);
    setDraftMsg(null);

    setProjectId(data.id);
    setSaving(false);
    setStep(2);
  }

  async function saveStep2() {
    setError('');
    if (isBlank(quotation)) { router.push(`/project/${projectId}`); return; } // nothing entered: same as Skip
    setSaving(true);
    const payload = clean(quotation);
    if (payload.quotation_value !== null) {
      const n = Number(String(payload.quotation_value).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(n) || String(payload.quotation_value).replace(/[^0-9.]/g, '') === '') {
        setError('Quotation Value must be a number, for example 250000.'); setSaving(false); return;
      }
      payload.quotation_value = n;
    }
    const { error } = await supabase.from('quotations').insert({ ...payload, project_id: projectId });
    if (error) { setError(error.message); setSaving(false); return; }
    setSaving(false);
    router.push(`/project/${projectId}`);
  }

  return (
    <div className="shell">
      <Sidebar active="new-project" />
      <div className="main">
        <div className="eyebrow">New Entry</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 24 }}>New Project</h1>

        {kept && step === 1 && (
          <div className="card np-kept" role="status">
            <div>
              <strong>Continue where you left off?</strong>
              <span>
                You have unsaved work{kept.data?.project?.name ? ` for “${kept.data.project.name}”` : ''} from {new Date(kept.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}.
              </span>
            </div>
            <div className="np-kept-actions">
              <button type="button" className="btn btn-primary" onClick={continueKept}>Continue</button>
              <button type="button" className="btn btn-ghost" onClick={discardKept}>Start fresh</button>
            </div>
          </div>
        )}

        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
            <span style={{ color: step >= 1 ? 'var(--violet)' : undefined }}>1. Project Details</span> →
            <span style={{ color: step >= 2 ? 'var(--violet)' : undefined }}>2. Quotation</span>
          </div>

          {step === 1 && (
            <>
              <div className="field-group">
                <label>Project Name *</label>
                <input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} required />
              </div>
              <div className="field-group">
                <label>Status *</label>
                <select value={project.status} onChange={(e) => setProject({ ...project, status: e.target.value })}>
                  {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="field-group">
                <label>Location</label>
                <input value={project.location} onChange={(e) => setProject({ ...project, location: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Brands Required</label>
                <BrandPicker value={project.brands_required} onChange={(v) => setProject({ ...project, brands_required: v })} />
              </div>
              <div className="form-row-2">
                <div className="field-group">
                  <label>Sales Person</label>
                  <select value={project.sales_person} onChange={(e) => setProject({ ...project, sales_person: e.target.value })}>
                    <option value="">Select…</option>
                    {SALES_PEOPLE.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div className="field-group">
                  <label>Headed By</label>
                  <select value={project.headed_by} onChange={(e) => setProject({ ...project, headed_by: e.target.value })}>
                    <option value="">Select…</option>
                    {HEADED_BY_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>
              <div className="field-group">
                <label>Supported By</label>
                <PeoplePicker
                  value={supporters}
                  onChange={setSupporters}
                  people={team.filter((t) => t.id !== myUserId)}
                  placeholder="Choose who supports this project (optional)"
                  ariaLabel="Supported by"
                />
              </div>
              <div className="field-group">
                <label>Note</label>
                <textarea rows={3} value={project.note} onChange={(e) => setProject({ ...project, note: e.target.value })} />
              </div>

              {CONTACT_ROLES.map(({ key, label }) => (
                <div className="field-group" key={key}>
                  <label>{label} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11.5 }}>business card details</span></label>
                  {contacts[key].map((c, idx) => (
                    <div key={idx} style={{ border: '1.5px dashed var(--line)', borderRadius: 10, padding: 14, marginBottom: 8, background: 'var(--paper)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet)', textTransform: 'uppercase' }}>Contact {idx + 1}</span>
                        <span onClick={() => removeContact(key, idx)} style={{ fontSize: 11, color: '#B33A3A', cursor: 'pointer', fontWeight: 600 }}>Remove</span>
                      </div>
                      <div style={{ marginBottom: 8 }}>
                        <SuggestInput placeholder="Company name" value={c.company_name || ''} options={companyOptions(contactNames, key, typedCompanies(key))} onChange={(v) => updateContact(key, idx, 'company_name', v)} />
                      </div>
                      <div className='form-row-2' style={{ marginBottom: 8 }}>
                        <SuggestInput
                        placeholder="Name"
                        value={c.name}
                        firstOptions={personOptions(contactNames, key, c.company_name, typedPeople(key)).first}
                        firstLabel={c.company_name ? `From ${c.company_name}` : undefined}
                        options={personOptions(contactNames, key, c.company_name, typedPeople(key)).rest}
                        onChange={(v) => updateContact(key, idx, 'name', v)}
                        onPick={(v) => fillSavedPerson(key, idx, v)}
                      />
                        <SuggestInput
                          placeholder="Designation (choose or type)"
                          value={c.designation || ''}
                          options={designationOptions(contactNames, Object.values(contacts).flat().map((x) => x.designation).filter(Boolean))}
                          onChange={(v) => updateContact(key, idx, 'designation', v)}
                        />
                      </div>
                      <div className='form-row-3'>
                        <input placeholder="Tel" value={c.tel} onChange={(e) => updateContact(key, idx, 'tel', e.target.value)} />
                        <input placeholder="Mobile" value={c.mobile} onChange={(e) => updateContact(key, idx, 'mobile', e.target.value)} />
                        <input placeholder="Email" value={c.email} onChange={(e) => updateContact(key, idx, 'email', e.target.value)} />
                      </div>
                    </div>
                  ))}
                  <span onClick={() => addContact(key)} style={{ fontSize: 12, color: 'var(--violet-2)', fontWeight: 600, cursor: 'pointer' }}>
                    ＋ Add another {label.toLowerCase()} contact
                  </span>
                </div>
              ))}

              {error && <div className="error-text">{error}</div>}
              {draftMsg && <div className={draftMsg.ok ? 'notice ok' : 'notice err'} style={{ marginTop: 8 }}>{draftMsg.text}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                <button className="btn btn-primary" onClick={saveStep1} disabled={saving || draftSaving || !project.name.trim()}>
                  {saving ? 'Saving…' : 'Save & Continue →'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={saveDraft} disabled={saving || draftSaving}>
                  {draftSaving ? 'Saving draft…' : draftId ? '📝 Update draft' : '📝 Save as draft'}
                </button>
              </div>
              {!project.name.trim() && <div className="hint">Project Name is needed to continue. You can save a draft without it.</div>}
            </>
          )}

          {step === 2 && (
            <>
              <div className="field-group">
                <label>Quotation Number</label>
                <input value={quotation.quotation_number} onChange={(e) => setQuotation({ ...quotation, quotation_number: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Quotation Date</label>
                <DateInput value={quotation.quotation_date} onChange={(e) => setQuotation({ ...quotation, quotation_date: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Target Date for Submission</label>
                <DateInput value={quotation.target_submission_date} onChange={(e) => setQuotation({ ...quotation, target_submission_date: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Quotation Value</label>
                <input value={quotation.quotation_value} onChange={(e) => setQuotation({ ...quotation, quotation_value: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={saveStep2} disabled={saving}>
                  {saving ? 'Saving…' : 'Save & Finish ✓'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => router.push(`/project/${projectId}`)} disabled={saving}>
                  Skip — finish without a quotation
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

function friendlyDraftError(message = '') {
  if (/project_drafts|relation|schema cache|does not exist/i.test(message)) {
    return 'Drafts need a one-time database update. Please ask your admin to run the "project drafts" update in Supabase.';
  }
  return message;
}
