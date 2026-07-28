'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';

export default function NewProject() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(1);
  const [projectId, setProjectId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [project, setProject] = useState({ name: '', status: 'design', location: '', brands_required: 'European' });
  const [contact, setContact] = useState({ name: '', designation: '', tel: '', email: '' });
  const [quotation, setQuotation] = useState({ quotation_number: '', quotation_date: '', target_submission_date: '', quotation_value: '' });
  const [meeting, setMeeting] = useState({ meeting_date: '', venue: '', notes: '', actions: '' });

  async function saveStep1() {
    setError(''); setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from('projects')
      .insert({ ...project, percent_complete: 10, created_by: user.id })
      .select()
      .single();

    if (error) { setError(error.message); setSaving(false); return; }

    if (contact.name) {
      await supabase.from('contacts').insert({ ...contact, project_id: data.id, contact_role: 'contractor' });
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
    router.push('/dashboard');
  }

  return (
    <div className="shell">
      <div className="main">
        <h1 style={{ fontSize: 28, marginBottom: 24 }}>New Project</h1>

        <div className="card" style={{ maxWidth: 640 }}>
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
              <div className="field-group">
                <label>Contractor Contact — Name</label>
                <input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <button className="btn btn-primary" onClick={saveStep1} disabled={saving || !project.name}>
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
