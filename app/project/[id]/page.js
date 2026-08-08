'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabaseClient';

const STATUS_LABELS = { design: 'Design', tender: 'Tender', job_in_hand: 'Job in Hand' };
const ROLE_LABELS = { contractor: 'Contractor', client: 'Client', consultant: 'Consultant', main_contractor: 'Main Contractor' };

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
  const [myRole, setMyRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', location: '', brands_required: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [projectId]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    setMyRole(me?.role);

    const [{ data: proj }, { data: c }, { data: q }, { data: m }, { data: fileList }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('contacts').select('*').eq('project_id', projectId).order('contact_role'),
      supabase.from('quotations').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
      supabase.from('meetings').select('*').eq('project_id', projectId).order('meeting_date', { ascending: false }),
      supabase.storage.from('project-files').list(projectId),
    ]);

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

  async function saveEdit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    const { error } = await supabase.from('projects').update({
      name: editForm.name,
      location: editForm.location,
      brands_required: editForm.brands_required,
    }).eq('id', projectId);
    if (error) { setError(error.message); setSaving(false); return; }
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

  if (loading) return <div className="shell"><div className="main">Loading…</div></div>;
  if (!project) return <div className="shell"><div className="main">Project not found, or you don't have access to it.</div></div>;

  return (
    <div className="shell">
      <div className="main" style={{ maxWidth: 820 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          {editing ? (
            <form onSubmit={saveEdit} style={{ flex: 1, marginRight: 20 }}>
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
              {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
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
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit</button>
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
            <div style={{ fontWeight: 700, color: 'var(--violet)' }}>{project.percent_complete}%</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Brands Required</div>
            <div style={{ fontWeight: 600 }}>{project.brands_required || '—'}</div>
          </div>
        </div>

        {/* Contacts */}
        <SectionTitle>Contacts</SectionTitle>
        <div className="card" style={{ marginBottom: 20 }}>
          {contacts.length === 0 ? <Empty text="No contacts added yet." /> : (
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
          {quotations.length === 0 ? <Empty text="No quotations yet." /> : quotations.map((q) => (
            <div key={q.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
              <strong>{q.quotation_number || 'Untitled'}</strong> — {q.quotation_value ? `AED ${q.quotation_value}` : 'no value set'}
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Dated {q.quotation_date || '—'}, target submission {q.target_submission_date || '—'}</div>
            </div>
          ))}
        </div>

        {/* Meetings */}
        <SectionTitle>Meetings</SectionTitle>
        <div className="card" style={{ marginBottom: 20 }}>
          {meetings.length === 0 ? <Empty text="No meetings logged yet." /> : meetings.map((m) => (
            <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
              <strong>{m.meeting_date || 'Undated'}</strong>{m.venue ? ` at ${m.venue}` : ''}
              {m.notes && <div style={{ fontSize: 12.5, marginTop: 2 }}>{m.notes}</div>}
              {m.actions && <div style={{ fontSize: 12.5, color: 'var(--violet-2)', marginTop: 2 }}>Actions: {m.actions}</div>}
            </div>
          ))}
        </div>

        {/* Files */}
        <SectionTitle>Files</SectionTitle>
        <div className="card">
          {error && <div className="error-text" style={{ marginBottom: 10 }}>{error}</div>}
          <input type="file" onChange={handleFileUpload} disabled={uploading} style={{ marginBottom: 14 }} />
          {files.length === 0 ? <Empty text="No files uploaded yet." /> : files.map((f) => (
            <div key={f.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
              <span>{f.name.replace(/^\d+_/, '')}</span>
              <span onClick={() => downloadFile(f.name)} style={{ color: 'var(--violet-2)', cursor: 'pointer', fontWeight: 600 }}>Download</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 8, marginTop: 4 }}>{children}</div>;
}
function Empty({ text }) {
  return <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>{text}</div>;
}
