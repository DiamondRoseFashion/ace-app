'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';

const STATUS_LABELS = { design: 'Design', tender: 'Tender', job_in_hand: 'Job in Hand' };
const ROLE_LABELS = { contractor: 'Contractor', client: 'Client', consultant: 'Consultant', main_contractor: 'Main Contractor' };
const CONTACT_ROLES = [
  { key: 'contractor', label: 'Contractor' },
  { key: 'client', label: 'Client' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'main_contractor', label: 'Main Contractor' },
];
const DESIGNATIONS = [
  'Manager', 'Project Manager', 'Site Engineer', 'Sales Engineer',
  'Procurement Manager', 'Owner', 'Director', 'Consultant', 'Supervisor', 'Other',
];

function emptyContact() {
  return { id: null, name: '', designation: '', tel: '', mobile: '', email: '' };
}
function emptyQuotation() {
  return {
    id: null, quotation_number: '', quotation_date: '', target_submission_date: '', quotation_value: '',
    quotation_status: '', win_percentage: '', issued_by: '', opportunity_ref: '', customer_name: '',
    client: '', consultant: '', item: '', remarks: '', contractor: '',
  };
}
function emptyMeeting() {
  return { id: null, meeting_date: '', venue: '', notes: '', actions: '' };
}

export default function ProjectDetail() {
  const router = useRouter();
  const params = useParams();
  const supabase = createClient();
  const projectId = params.id;

  const [project, setProject] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [quotations, setQuotations] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [files, setFiles] = useState([]);
  const [activity, setActivity] = useState([]);
  const [myRole, setMyRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', location: '', brands_required: '' });
  const [editContacts, setEditContacts] = useState({ contractor: [], client: [], consultant: [], main_contractor: [] });
  const [editQuotations, setEditQuotations] = useState([]);
  const [editMeetings, setEditMeetings] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    setMyRole(me?.role);

    const [{ data: proj }, { data: c }, { data: q }, { data: m }, { data: fileList }, { data: log }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('contacts').select('*').eq('project_id', projectId).order('contact_role'),
      supabase.from('quotations').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('meetings').select('*').eq('project_id', projectId).order('meeting_date', { ascending: false }),
      supabase.storage.from('project-files').list(projectId),
      supabase.from('audit_log').select('*, actor:profiles!changed_by(full_name)').eq('project_id', projectId).order('changed_at', { ascending: false }).limit(50),
    ]);

    setActivity(log || []);

    setProject(proj);
    if (proj) {
      setEditForm({
        name: proj.name || '',
        location: proj.location || '',
        brands_required: proj.brands_required || '',
      });
    }
    setContacts(c || []);
    setQuotations(q || []);
    setMeetings(m || []);
    setFiles(fileList || []);
    setLoading(false);
  }

  async function updateStatus(newStatus) {
    await supabase.from('projects').update({ status: newStatus }).eq('id', projectId);
    load();
  }

  function startEditing() {
    const grouped = { contractor: [], client: [], consultant: [], main_contractor: [] };
    (contacts || []).forEach((c) => {
      if (grouped[c.contact_role]) grouped[c.contact_role].push({ ...c });
    });
    CONTACT_ROLES.forEach(({ key }) => {
      if (grouped[key].length === 0) grouped[key] = [];
    });
    setEditContacts(grouped);
    setEditQuotations((quotations || []).map((q) => ({ ...q })));
    setEditMeetings((meetings || []).map((m) => ({ ...m })));
    setEditing(true);
  }

  function addEditContact(roleKey) {
    setEditContacts((c) => ({ ...c, [roleKey]: [...c[roleKey], emptyContact()] }));
  }
  function removeEditContact(roleKey, idx) {
    setEditContacts((c) => ({ ...c, [roleKey]: c[roleKey].filter((_, i) => i !== idx) }));
  }
  function updateEditContact(roleKey, idx, field, value) {
    setEditContacts((c) => {
      const list = [...c[roleKey]];
      list[idx] = { ...list[idx], [field]: value };
      return { ...c, [roleKey]: list };
    });
  }

  function addEditQuotation() {
    setEditQuotations((qs) => [...qs, emptyQuotation()]);
  }
  function removeEditQuotation(idx) {
    setEditQuotations((qs) => qs.filter((_, i) => i !== idx));
  }
  function updateEditQuotation(idx, field, value) {
    setEditQuotations((qs) => {
      const list = [...qs];
      list[idx] = { ...list[idx], [field]: value };
      return list;
    });
  }

  function addEditMeeting() {
    setEditMeetings((ms) => [...ms, emptyMeeting()]);
  }
  function removeEditMeeting(idx) {
    setEditMeetings((ms) => ms.filter((_, i) => i !== idx));
  }
  function updateEditMeeting(idx, field, value) {
    setEditMeetings((ms) => {
      const list = [...ms];
      list[idx] = { ...list[idx], [field]: value };
      return list;
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    setSaving(true); setError('');

    // 1. Project fields
    const { error: projErr } = await supabase.from('projects').update({
      name: editForm.name,
      location: editForm.location,
      brands_required: editForm.brands_required,
    }).eq('id', projectId);
    if (projErr) { setError(projErr.message); setSaving(false); return; }

    // 2. Contacts: delete removed, update existing, insert new
    const flatEditContacts = Object.entries(editContacts).flatMap(([roleKey, list]) =>
      list.map((c) => ({ ...c, contact_role: roleKey }))
    );
    const originalContactIds = contacts.map((c) => c.id);
    const keptContactIds = flatEditContacts.filter((c) => c.id).map((c) => c.id);
    const deletedContactIds = originalContactIds.filter((id) => !keptContactIds.includes(id));

    if (deletedContactIds.length > 0) {
      const { error: delErr } = await supabase.from('contacts').delete().in('id', deletedContactIds);
      if (delErr) { setError(delErr.message); setSaving(false); return; }
    }
    for (const c of flatEditContacts) {
      if (!c.name.trim()) continue;
      const payload = { name: c.name, designation: c.designation, tel: c.tel, mobile: c.mobile, email: c.email, contact_role: c.contact_role };
      if (c.id) {
        const { error: updErr } = await supabase.from('contacts').update(payload).eq('id', c.id);
        if (updErr) { setError(updErr.message); setSaving(false); return; }
      } else {
        const { error: insErr } = await supabase.from('contacts').insert({ ...payload, project_id: projectId });
        if (insErr) { setError(insErr.message); setSaving(false); return; }
      }
    }

    // 3. Quotations: delete removed, update existing, insert new
    const originalQuotationIds = quotations.map((q) => q.id);
    const keptQuotationIds = editQuotations.filter((q) => q.id).map((q) => q.id);
    const deletedQuotationIds = originalQuotationIds.filter((id) => !keptQuotationIds.includes(id));

    if (deletedQuotationIds.length > 0) {
      const { error: delErr } = await supabase.from('quotations').delete().in('id', deletedQuotationIds);
      if (delErr) { setError(delErr.message); setSaving(false); return; }
    }
    for (const q of editQuotations) {
      const payload = {
        quotation_number: q.quotation_number, quotation_date: q.quotation_date || null,
        target_submission_date: q.target_submission_date || null, quotation_value: q.quotation_value,
        quotation_status: q.quotation_status, win_percentage: q.win_percentage, issued_by: q.issued_by,
        opportunity_ref: q.opportunity_ref, customer_name: q.customer_name, client: q.client,
        consultant: q.consultant, item: q.item, remarks: q.remarks, contractor: q.contractor,
      };
      if (q.id) {
        const { error: updErr } = await supabase.from('quotations').update(payload).eq('id', q.id);
        if (updErr) { setError(updErr.message); setSaving(false); return; }
      } else {
        if (!q.quotation_number && !q.quotation_value) continue;
        const { error: insErr } = await supabase.from('quotations').insert({ ...payload, project_id: projectId });
        if (insErr) { setError(insErr.message); setSaving(false); return; }
      }
    }

    // 4. Meetings: delete removed, update existing, insert new
    const originalMeetingIds = meetings.map((m) => m.id);
    const keptMeetingIds = editMeetings.filter((m) => m.id).map((m) => m.id);
    const deletedMeetingIds = originalMeetingIds.filter((id) => !keptMeetingIds.includes(id));

    if (deletedMeetingIds.length > 0) {
      const { error: delErr } = await supabase.from('meetings').delete().in('id', deletedMeetingIds);
      if (delErr) { setError(delErr.message); setSaving(false); return; }
    }
    for (const m of editMeetings) {
      const payload = { meeting_date: m.meeting_date || null, venue: m.venue, notes: m.notes, actions: m.actions };
      if (m.id) {
        const { error: updErr } = await supabase.from('meetings').update(payload).eq('id', m.id);
        if (updErr) { setError(updErr.message); setSaving(false); return; }
      } else {
        if (!m.meeting_date && !m.venue && !m.notes && !m.actions) continue;
        const { error: insErr } = await supabase.from('meetings').insert({ ...payload, project_id: projectId });
        if (insErr) { setError(insErr.message); setSaving(false); return; }
      }
    }

    setEditing(false);
    setSaving(false);
    load();
  }

  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true); setError('');
    const path = `${projectId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('project-files').upload(path, file);
    if (error) setError(error.message);
    else load();
    setUploading(false);
  }

  async function downloadFile(fileName) {
    const { data, error } = await supabase.storage.from('project-files').download(`${projectId}/${fileName}`);
    if (error) { setError(error.message); return; }
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  const canManage = myRole === 'owner' || myRole === 'admin' || myRole === 'manager' || myRole === 'employee';

  if (loading) return <div className="shell"><Sidebar active="dashboard" /><div className="main">Loading…</div></div>;
  if (!project) return <div className="shell"><Sidebar active="dashboard" /><div className="main">Project not found, or you don't have access to it.</div></div>;

  return (
    <div className="shell">
      <Sidebar active="dashboard" />
      <div className="main" style={{ maxWidth: 820 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          {editing ? (
            <div style={{ flex: 1, marginRight: 20 }}>
              <div className="field-group">
                <label>Project Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required />
              </div>
              <div className="field-group">
                <label>Location</label>
                <input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Brands Required</label>
                <select value={editForm.brands_required} onChange={(e) => setEditForm({ ...editForm, brands_required: e.target.value })}>
                  <option value="">—</option>
                  <option>European</option>
                  <option>Local</option>
                  <option>PRC</option>
                </select>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--violet-2)', fontWeight: 600 }}>
                {project.location || 'No location set'}
              </div>
              <h1 style={{ fontSize: 28 }}>{project.name}</h1>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            {!editing && canManage && (
              <button className="btn btn-ghost" onClick={startEditing}>Edit</button>
            )}
            <Link href="/dashboard"><button className="btn btn-ghost">← Back to Projects</button></Link>
          </div>
        </div>

        {/* Overview */}
        <div className="card" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Status</div>
            {canManage ? (
              <select value={project.status} onChange={(e) => updateStatus(e.target.value)}>
                <option value="design">Design</option>
                <option value="tender">Tender</option>
                <option value="job_in_hand">Job in Hand</option>
              </select>
            ) : (
              <div style={{ fontWeight: 600 }}>{STATUS_LABELS[project.status]}</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Progress</div>
            <div className="mono" style={{ fontWeight: 700, color: 'var(--violet)', fontSize: 15 }}>{project.percent_complete}%</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Brands Required</div>
            <div style={{ fontWeight: 600 }}>{project.brands_required || '—'}</div>
          </div>
        </div>

        {/* Contacts */}
        <SectionTitle>Contacts</SectionTitle>
        <div className="card" style={{ marginBottom: 20 }}>
          {editing ? (
            CONTACT_ROLES.map(({ key, label }) => (
              <div className="field-group" key={key}>
                <label>{label}</label>
                {editContacts[key].map((c, idx) => (
                  <div key={idx} style={{ border: '1.5px dashed var(--line)', borderRadius: 10, padding: 14, marginBottom: 8, background: '#FCFAFE' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet)', textTransform: 'uppercase' }}>Contact {idx + 1}</span>
                      <span onClick={() => removeEditContact(key, idx)} style={{ fontSize: 11, color: '#B33A3A', cursor: 'pointer', fontWeight: 600 }}>Remove</span>
                    </div>
                    <div className="form-row-2" style={{ marginBottom: 8 }}>
                      <input placeholder="Name" value={c.name} onChange={(e) => updateEditContact(key, idx, 'name', e.target.value)} />
                      <select value={c.designation} onChange={(e) => updateEditContact(key, idx, 'designation', e.target.value)}>
                        <option value="">Designation…</option>
                        {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div className="form-row-3">
                      <input placeholder="Tel" value={c.tel} onChange={(e) => updateEditContact(key, idx, 'tel', e.target.value)} />
                      <input placeholder="Mobile" value={c.mobile} onChange={(e) => updateEditContact(key, idx, 'mobile', e.target.value)} />
                      <input placeholder="Email" value={c.email} onChange={(e) => updateEditContact(key, idx, 'email', e.target.value)} />
                    </div>
                  </div>
                ))}
                <span onClick={() => addEditContact(key)} style={{ fontSize: 12, color: 'var(--violet-2)', fontWeight: 600, cursor: 'pointer' }}>
                  ＋ Add another {label.toLowerCase()} contact
                </span>
              </div>
            ))
          ) : contacts.length === 0 ? <Empty text="No contacts added yet." /> : (
            Object.entries(ROLE_LABELS).map(([key, label]) => {
              const roleContacts = contacts.filter((c) => c.contact_role === key);
              if (roleContacts.length === 0) return null;
              return (
                <div key={key} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet-2)', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
                  {roleContacts.map((c) => (
                    <div key={c.id} style={{ fontSize: 13.5, marginBottom: 4 }}>
                      <strong>{c.name}</strong>{c.designation ? ` — ${c.designation}` : ''}
                      {c.tel && <span style={{ color: 'var(--muted)' }}> · {c.tel}</span>}
                      {c.email && <span style={{ color: 'var(--muted)' }}> · {c.email}</span>}
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* Quotations */}
        <SectionTitle>Quotations</SectionTitle>
        <div className="card" style={{ marginBottom: 20 }}>
          {editing ? (
            <>
              {editQuotations.map((q, idx) => (
                <div key={idx} style={{ border: '1.5px dashed var(--line)', borderRadius: 10, padding: 14, marginBottom: 12, background: '#FCFAFE' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet)', textTransform: 'uppercase' }}>Quotation {idx + 1}</span>
                    <span onClick={() => removeEditQuotation(idx)} style={{ fontSize: 11, color: '#B33A3A', cursor: 'pointer', fontWeight: 600 }}>Remove</span>
                  </div>
                  <div className="form-row-2" style={{ marginBottom: 8 }}>
                    <input placeholder="Quotation Number" value={q.quotation_number || ''} onChange={(e) => updateEditQuotation(idx, 'quotation_number', e.target.value)} />
                    <input placeholder="Value" value={q.quotation_value || ''} onChange={(e) => updateEditQuotation(idx, 'quotation_value', e.target.value)} />
                  </div>
                  <div className="form-row-2" style={{ marginBottom: 8 }}>
                    <div>
                      <label style={{ fontSize: 11 }}>Quotation Date</label>
                      <input type="date" value={q.quotation_date || ''} onChange={(e) => updateEditQuotation(idx, 'quotation_date', e.target.value)} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11 }}>Target Submission</label>
                      <input type="date" value={q.target_submission_date || ''} onChange={(e) => updateEditQuotation(idx, 'target_submission_date', e.target.value)} />
                    </div>
                  </div>
                  <div className="form-row-2" style={{ marginBottom: 8 }}>
                    <select value={q.quotation_status || ''} onChange={(e) => updateEditQuotation(idx, 'quotation_status', e.target.value)}>
                      <option value="">Status…</option>
                      <option value="pending">Pending</option>
                      <option value="win">Win</option>
                      <option value="lost">Lost</option>
                    </select>
                    <input placeholder="Win %" value={q.win_percentage || ''} onChange={(e) => updateEditQuotation(idx, 'win_percentage', e.target.value)} />
                  </div>
                  <div className="form-row-2" style={{ marginBottom: 8 }}>
                    <input placeholder="Issued By" value={q.issued_by || ''} onChange={(e) => updateEditQuotation(idx, 'issued_by', e.target.value)} />
                    <input placeholder="Opportunity Ref." value={q.opportunity_ref || ''} onChange={(e) => updateEditQuotation(idx, 'opportunity_ref', e.target.value)} />
                  </div>
                  <div className="form-row-2" style={{ marginBottom: 8 }}>
                    <input placeholder="Customer Name" value={q.customer_name || ''} onChange={(e) => updateEditQuotation(idx, 'customer_name', e.target.value)} />
                    <input placeholder="Client" value={q.client || ''} onChange={(e) => updateEditQuotation(idx, 'client', e.target.value)} />
                  </div>
                  <div className="form-row-2" style={{ marginBottom: 8 }}>
                    <input placeholder="Consultant" value={q.consultant || ''} onChange={(e) => updateEditQuotation(idx, 'consultant', e.target.value)} />
                    <input placeholder="Contractor" value={q.contractor || ''} onChange={(e) => updateEditQuotation(idx, 'contractor', e.target.value)} />
                  </div>
                  <div className="field-group" style={{ marginBottom: 8 }}>
                    <input placeholder="Item" value={q.item || ''} onChange={(e) => updateEditQuotation(idx, 'item', e.target.value)} />
                  </div>
                  <textarea placeholder="Remarks" rows={2} value={q.remarks || ''} onChange={(e) => updateEditQuotation(idx, 'remarks', e.target.value)} />
                </div>
              ))}
              <span onClick={addEditQuotation} style={{ fontSize: 12, color: 'var(--violet-2)', fontWeight: 600, cursor: 'pointer' }}>
                ＋ Add another quotation
              </span>
            </>
          ) : quotations.length === 0 ? <Empty text="No quotations yet." /> : quotations.map((q) => (
            <div key={q.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
              <strong>{q.quotation_number || 'Untitled'}</strong> — {q.quotation_value ? `AED ${q.quotation_value}` : 'no value set'}
              {q.quotation_status && <span className={`pill pill-${q.quotation_status}`} style={{ marginLeft: 8 }}>{q.quotation_status}</span>}
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                Dated {q.quotation_date || '—'}, target submission {q.target_submission_date || '—'}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
                {q.win_percentage && <div><span style={{ color: 'var(--muted)' }}>Win %:</span> {q.win_percentage}%</div>}
                {q.issued_by && <div><span style={{ color: 'var(--muted)' }}>Issued by:</span> {q.issued_by}</div>}
                {q.opportunity_ref && <div><span style={{ color: 'var(--muted)' }}>Opportunity ref:</span> {q.opportunity_ref}</div>}
                {q.customer_name && <div><span style={{ color: 'var(--muted)' }}>Customer:</span> {q.customer_name}</div>}
                {q.client && <div><span style={{ color: 'var(--muted)' }}>Client:</span> {q.client}</div>}
                {q.consultant && <div><span style={{ color: 'var(--muted)' }}>Consultant:</span> {q.consultant}</div>}
                {q.contractor && <div><span style={{ color: 'var(--muted)' }}>Contractor:</span> {q.contractor}</div>}
                {q.item && <div><span style={{ color: 'var(--muted)' }}>Item:</span> {q.item}</div>}
              </div>
              {q.remarks && <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--muted)' }}>Remarks: {q.remarks}</div>}
            </div>
          ))}
        </div>

        {/* Meetings */}
        <SectionTitle>Meetings</SectionTitle>
        <div className="card" style={{ marginBottom: 20 }}>
          {editing ? (
            <>
              {editMeetings.map((m, idx) => (
                <div key={idx} style={{ border: '1.5px dashed var(--line)', borderRadius: 10, padding: 14, marginBottom: 12, background: '#FCFAFE' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet)', textTransform: 'uppercase' }}>Meeting {idx + 1}</span>
                    <span onClick={() => removeEditMeeting(idx)} style={{ fontSize: 11, color: '#B33A3A', cursor: 'pointer', fontWeight: 600 }}>Remove</span>
                  </div>
                  <div className="form-row-2" style={{ marginBottom: 8 }}>
                    <input type="date" value={m.meeting_date || ''} onChange={(e) => updateEditMeeting(idx, 'meeting_date', e.target.value)} />
                    <input placeholder="Venue" value={m.venue || ''} onChange={(e) => updateEditMeeting(idx, 'venue', e.target.value)} />
                  </div>
                  <textarea placeholder="Notes" rows={2} value={m.notes || ''} onChange={(e) => updateEditMeeting(idx, 'notes', e.target.value)} style={{ marginBottom: 8 }} />
                  <textarea placeholder="Course of Actions" rows={2} value={m.actions || ''} onChange={(e) => updateEditMeeting(idx, 'actions', e.target.value)} />
                </div>
              ))}
              <span onClick={addEditMeeting} style={{ fontSize: 12, color: 'var(--violet-2)', fontWeight: 600, cursor: 'pointer' }}>
                ＋ Add another meeting
              </span>
            </>
          ) : meetings.length === 0 ? <Empty text="No meetings logged yet." /> : meetings.map((m) => (
            <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
              <strong>{m.meeting_date || 'Undated'}</strong>{m.venue ? ` at ${m.venue}` : ''}
              {m.notes && <div style={{ fontSize: 12.5, marginTop: 2 }}>{m.notes}</div>}
              {m.actions && <div style={{ fontSize: 12.5, color: 'var(--violet-2)', marginTop: 2 }}>Actions: {m.actions}</div>}
            </div>
          ))}
        </div>

        {editing && (
          <div className="card" style={{ marginBottom: 20 }}>
            {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save all changes'}
              </button>
              <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            </div>
          </div>
        )}

        {/* Files */}
        <SectionTitle>Files</SectionTitle>
        <div className="card" style={{ marginBottom: 20 }}>
          {error && !editing && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
          <input type="file" onChange={handleFileUpload} disabled={uploading} style={{ marginBottom: 14 }} />
          {files.length === 0 ? <Empty text="No files uploaded yet." /> : files.map((f) => (
            <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
              <span>{f.name.replace(/^\d+_/, '')}</span>
              <span onClick={() => downloadFile(f.name)} style={{ color: 'var(--violet-2)', cursor: 'pointer', fontWeight: 600 }}>Download</span>
            </div>
          ))}
        </div>

        {/* Activity */}
        <SectionTitle>Activity</SectionTitle>
        <div className="card">
          {activity.length === 0 ? <Empty text="No activity recorded yet." /> : activity.map((a) => (
            <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
              <span>{describeActivity(a)}</span>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                {a.actor?.full_name || 'Someone'} · {new Date(a.changed_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const TABLE_LABELS = { projects: 'the project', contacts: 'a contact', quotations: 'a quotation', meetings: 'a meeting' };
const FIELD_LABELS = {
  name: 'Name', location: 'Location', status: 'Status', brands_required: 'Brands Required',
  percent_complete: 'Progress', quotation_number: 'Quotation Number', quotation_value: 'Value',
  meeting_date: 'Meeting Date', venue: 'Venue', notes: 'Notes', actions: 'Actions',
};
const SKIP_FIELDS = new Set(['id', 'created_at', 'updated_at', 'project_id']);

function describeActivity(a) {
  const thing = TABLE_LABELS[a.table_name] || a.table_name;
  if (a.action === 'insert') return `Added ${thing}`;
  if (a.action === 'delete') return `Removed ${thing}`;

  const before = a.old_data || {};
  const after = a.new_data || {};
  const changes = Object.keys(after)
    .filter((k) => !SKIP_FIELDS.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => {
      const label = FIELD_LABELS[k] || k;
      const from = before[k] ?? '—';
      const to = after[k] ?? '—';
      return `${label}: ${from} → ${to}`;
    });
  if (changes.length === 0) return `Updated ${thing}`;
  return `Updated ${thing} — ${changes.join(', ')}`;
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)', marginBottom: 8, marginTop: 4 }}>{children}</div>;
}
function Empty({ text }) {
  return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>{text}</div>;
}