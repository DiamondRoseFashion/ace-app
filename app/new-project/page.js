'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';

const CONTACT_ROLES = [
  { key: 'contractor', label: 'Contractor' },
  { key: 'client', label: 'Client' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'main_contractor', label: 'Main Contractor' },
];

function emptyContact() {
  return { name: '', designation: '', tel: '', mobile: '', email: '' };
}

const DESIGNATIONS = [
  'Manager', 'Project Manager', 'Site Engineer', 'Sales Engineer',
  'Procurement Manager', 'Owner', 'Director', 'Consultant', 'Supervisor', 'Other',
];

export default function NewProject() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [project, setProject] = useState({ name: '', status: 'design', location: '', brands_required: 'European' });

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
  quotation_status: '',
  win_percentage: '',
  issued_by: '',
  opportunity_ref: '',
  customer_name: '',
  client: '',
  consultant: '',
  item: '',
  remarks: '',
  contractor: '',
}); 
  const [meeting, setMeeting] = useState({ meeting_date: '', venue: '', notes: '', actions: '' });

  function addContact(roleKey) {
    setContacts((c) => ({ ...c, [roleKey]: [...c[roleKey], emptyContact()] }));
  }
  function removeContact(roleKey, idx) {
    setContacts((c) => ({ ...c, [roleKey]: c[roleKey].filter((_, i) => i !== idx) }));
  }
  function updateContact(roleKey, idx, field, value) {
    setContacts((c) => {
      const list = [...c[roleKey]];
      list[idx] = { ...list[idx], [field]: value };
      return { ...c, [roleKey]: list };
    });
  }

  async function logActivity(pid, action) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from('activity_log').insert({ project_id: pid, actor_id: user.id, action });
  }

  async function saveStep1() {
    setError(''); setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('projects')
      .insert({ ...project, percent_complete: 10, created_by: user.id })
      .select()
      .single();

    if (error) { setError(error.message); setSaving(false); return; }

    // flatten all non-empty contacts across all roles into insert rows
    const rows = [];
    for (const roleKey of Object.keys(contacts)) {
      for (const c of contacts[roleKey]) {
        if (c.name.trim()) rows.push({ ...c, project_id: data.id, contact_role: roleKey });
      }
    }
    if (rows.length > 0) {
      const { error: contactError } = await supabase.from('contacts').insert(rows);
      if (contactError) { setError(contactError.message); setSaving(false); return; }
    }

    setProjectId(data.id);
    await supabase.from('projects').update({ percent_complete: 20 }).eq('id', data.id);
    await logActivity(data.id, 'created the project');
    setSaving(false);
    setStep(2);
  }

  async function saveStep2() {
    setError(''); setSaving(true);
    const { error } = await supabase.from('quotations').insert({ ...quotation, project_id: projectId });
    if (error) { setError(error.message); setSaving(false); return; }
    await supabase.from('projects').update({ percent_complete: 30 }).eq('id', projectId);
    await logActivity(projectId, `added quotation ${quotation.quotation_number || '(no number)'}`);
    setSaving(false);
    setStep(3);
  }

  async function saveStep3() {
    setError(''); setSaving(true);
    const { error } = await supabase.from('meetings').insert({ ...meeting, project_id: projectId });
    if (error) { setError(error.message); setSaving(false); return; }
    await logActivity(projectId, `logged a meeting${meeting.meeting_date ? ' on ' + meeting.meeting_date : ''}`);
    setSaving(false);
    router.push(`/project/${projectId}`);
  }

  return (
    <div className="shell">
      <Sidebar active="new-project" />
      <div className="main">
        <div className="eyebrow">New Entry</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 24 }}>New Project</h1>

        <div className="card" style={{ maxWidth: 680 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
            <span style={{ color: step >= 1 ? 'var(--violet)' : undefined }}>1. Project Details</span> →
            <span style={{ color: step >= 2 ? 'var(--violet)' : undefined }}>2. Quotation</span> →
            <span style={{ color: step >= 3 ? 'var(--violet)' : undefined }}>3. Meetings</span>
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
                  <option value="design">Design</option>
                  <option value="tender">Tender</option>
                  <option value="job_in_hand">Job in Hand</option>
                </select>
              </div>
              <div className="field-group">
                <label>Location</label>
                <input value={project.location} onChange={(e) => setProject({ ...project, location: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Brands Required</label>
                <select value={project.brands_required} onChange={(e) => setProject({ ...project, brands_required: e.target.value })}>
                  <option>European</option>
                  <option>Local</option>
                  <option>PRC</option>
                </select>
              </div>

              {CONTACT_ROLES.map(({ key, label }) => (
                <div className="field-group" key={key}>
                  <label>{label} <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11.5 }}>business card details</span></label>
                  {contacts[key].map((c, idx) => (
                    <div key={idx} style={{ border: '1.5px dashed var(--line)', borderRadius: 10, padding: 14, marginBottom: 8, background: '#FCFAFE' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--violet)', textTransform: 'uppercase' }}>Contact {idx + 1}</span>
                        <span onClick={() => removeContact(key, idx)} style={{ fontSize: 11, color: '#B33A3A', cursor: 'pointer', fontWeight: 600 }}>Remove</span>
                      </div>
                      <div className='form-row-2' style={{ marginBottom: 8 }}>
                        <input placeholder="Name" value={c.name} onChange={(e) => updateContact(key, idx, 'name', e.target.value)} />
                        <select value={c.designation} onChange={(e) => updateContact(key, idx, 'designation', e.target.value)}>
                          <option value="">Designation…</option>
                          {DESIGNATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
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
              <button className="btn btn-primary" onClick={saveStep1} disabled={saving || !project.name} style={{ marginTop: 8 }}>
                {saving ? 'Saving…' : 'Save & Continue →'}
              </button>
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
                <input type="date" value={quotation.quotation_date} onChange={(e) => setQuotation({ ...quotation, quotation_date: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Target Date for Submission</label>
                <input type="date" value={quotation.target_submission_date} onChange={(e) => setQuotation({ ...quotation, target_submission_date: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Quotation Value</label>
                <input value={quotation.quotation_value} onChange={(e) => setQuotation({ ...quotation, quotation_value: e.target.value })} />
              </div>
	<div className="field-group">
                <label>Quotation Status</label>
                <select value={quotation.quotation_status} onChange={(e) => setQuotation({ ...quotation, quotation_status: e.target.value })}>
                  <option value="">Select…</option>
                  <option value="pending">Pending</option>
                  <option value="win">Win</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
              <div className="field-group">
                <label>Win %</label>
                <input value={quotation.win_percentage} onChange={(e) => setQuotation({ ...quotation, win_percentage: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Issued By</label>
                <input value={quotation.issued_by} onChange={(e) => setQuotation({ ...quotation, issued_by: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Opportunity Ref. (Project Name/Details)</label>
                <input value={quotation.opportunity_ref} onChange={(e) => setQuotation({ ...quotation, opportunity_ref: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Customer Name</label>
                <input value={quotation.customer_name} onChange={(e) => setQuotation({ ...quotation, customer_name: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Client</label>
                <input value={quotation.client} onChange={(e) => setQuotation({ ...quotation, client: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Consultant</label>
                <input value={quotation.consultant} onChange={(e) => setQuotation({ ...quotation, consultant: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Contractor</label>
                <input value={quotation.contractor} onChange={(e) => setQuotation({ ...quotation, contractor: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Item</label>
                <input value={quotation.item} onChange={(e) => setQuotation({ ...quotation, item: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Remarks</label>
                <textarea rows={3} value={quotation.remarks} onChange={(e) => setQuotation({ ...quotation, remarks: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <button className="btn btn-primary" onClick={saveStep2} disabled={saving}>
                {saving ? 'Saving…' : 'Save & Continue →'}
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <div className="field-group">
                <label>Meeting Date</label>
                <input type="date" value={meeting.meeting_date} onChange={(e) => setMeeting({ ...meeting, meeting_date: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Meeting Venue</label>
                <input value={meeting.venue} onChange={(e) => setMeeting({ ...meeting, venue: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Notes</label>
                <textarea rows={3} value={meeting.notes} onChange={(e) => setMeeting({ ...meeting, notes: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Course of Actions</label>
                <textarea rows={3} value={meeting.actions} onChange={(e) => setMeeting({ ...meeting, actions: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <button className="btn btn-primary" onClick={saveStep3} disabled={saving}>
                {saving ? 'Saving…' : 'Save & Finish ✓'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
