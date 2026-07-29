'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';

const CONTACT_ROLES = [
  { key: 'contractor', label: 'Contractor' },
  { key: 'client', label: 'Client' },
  { key: 'consultant', label: 'Consultant' },
  { key: 'main_contractor', label: 'Main Contractor' },
];

function emptyContact() {
  return { name: '', designation: '', tel: '', mobile: '', email: '' };
}

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

  const [quotation, setQuotation] = useState({ quotation_number: '', quotation_date: '', target_submission_date: '', quotation_value: '' });
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
    setSaving(false);
    setStep(2);
  }

  async function saveStep2() {
    setError(''); setSaving(true);
    const { error } = await supabase.from('quotations').insert({ ...quotation, project_id: projectId });
    if (error) { setError(error.message); setSaving(false); return; }
    await supabase.from('projects').update({ percent_complete: 30 }).eq('id', projectId);
    setSaving(false);
    setStep(3);
  }

  async function saveStep3() {
    setError(''); setSaving(true);
    const { error } = await supabase.from('meetings').insert({ ...meeting, project_id: projectId });
    if (error) { setError(error.message); setSaving(false); return; }
    setSaving(false);
    router.push(`/project/${projectId}`);
  }

  return (
    <div className="shell">
      <div className="main">
        <h1 style={{ fontSize: 28, marginBottom: 24 }}>New Project</h1>

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
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                        <input placeholder="Name" value={c.name} onChange={(e) => updateContact(key, idx, 'name', e.target.value)} />
                        <input placeholder="Designation" value={c.designation} onChange={(e) => updateContact(key, idx, 'designation', e.target.value)} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
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
