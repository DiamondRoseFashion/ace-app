'use client';

// Project Activity: the team writes short updates on a project.
// Everyone who can open the project sees them (managers see all
// projects), newest first, with who wrote it and when.
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';
import { fmtDateTime } from '@/lib/dates';

const MANAGEMENT = ['owner', 'admin', 'manager'];

export default function ActivityLog({ projectId, myId, myRole }) {
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [editId, setEditId] = useState(null);
  const [editText, setEditText] = useState('');
  const [missingTable, setMissingTable] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from('project_activity')
      .select('*, author:profiles!author_id(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) {
      if (/relation|schema cache|does not exist/i.test(error.message)) setMissingTable(true);
    } else {
      setEntries(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!projectId) return undefined;
    load();
    // live: new updates from others appear without refreshing
    const ch = supabase
      .channel(`activity-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_activity', filter: `project_id=eq.${projectId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const dirty = draft.trim().length > 0 || (editId && editText.trim().length > 0);

  async function saveChanges() {
    setMsg(null);
    setSaving(true);
    try {
      if (editId) {
        if (!editText.trim()) throw new Error('The update can’t be empty — use Delete to remove it.');
        const { data, error } = await supabase.from('project_activity')
          .update({ body: editText.trim(), updated_at: new Date().toISOString() })
          .eq('id', editId).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('You can only edit your own updates.');
        setEditId(null); setEditText('');
      }
      if (draft.trim()) {
        const { error } = await supabase.from('project_activity')
          .insert({ project_id: projectId, body: draft.trim() });
        if (error) throw error;
        setDraft('');
      }
      setMsg({ ok: true, text: 'Saved.' });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: /relation|schema cache|does not exist/i.test(e.message || '')
        ? 'Activity needs a one-time database update. Please ask your admin.'
        : (e.message || 'Could not save.') });
    }
    setSaving(false);
  }

  async function remove(entry) {
    setMsg(null);
    const { data, error } = await supabase.from('project_activity').delete().eq('id', entry.id).select('id');
    if (error || !data?.length) { setMsg({ ok: false, text: error?.message || 'You can only delete your own updates.' }); return; }
    if (editId === entry.id) { setEditId(null); setEditText(''); }
    load();
  }

  return (
    <div className="card activity-card">
      <div className="activity-head">
        <div className="activity-hint">Write what happened on this project: calls, site visits, next steps.</div>
        <button type="button" className="btn btn-primary" onClick={saveChanges} disabled={saving || !dirty || missingTable}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {missingTable ? (
        <div className="notice err" style={{ marginBottom: 0 }}>Activity needs a one-time database update. Please ask your admin.</div>
      ) : (
        <>
          <label htmlFor="activity-new" className="sr-only">New activity update</label>
          <textarea
            id="activity-new"
            rows={3}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMsg(null); }}
            placeholder="e.g. Met the consultant on site, samples approved, LPO expected next week…"
            maxLength={4000}
          />
          {msg && <div className={msg.ok ? 'notice ok' : 'notice err'} style={{ marginTop: 10, marginBottom: 0 }}>{msg.text}</div>}

          <div className="activity-list">
            {loading ? <div className="activity-empty">Loading…</div>
              : entries.length === 0 ? <div className="activity-empty">No activity recorded yet.</div>
                : entries.map((a) => {
                  const mine = a.author_id === myId;
                  const canDelete = mine || MANAGEMENT.includes(myRole);
                  const editing = editId === a.id;
                  return (
                    <div key={a.id} className="activity-item">
                      <div className="activity-meta">
                        <strong>{a.author?.full_name || 'Someone'}</strong>
                        <span> · {fmtDateTime(a.created_at)}{a.updated_at ? ' · edited' : ''}</span>
                        <span style={{ flex: 1 }} />
                        {mine && !editing && (
                          <button type="button" className="link-btn" onClick={() => { setEditId(a.id); setEditText(a.body); setMsg(null); }}>Edit</button>
                        )}
                        {editing && (
                          <button type="button" className="link-btn" onClick={() => { setEditId(null); setEditText(''); }}>Cancel</button>
                        )}
                        {canDelete && (
                          <button type="button" className="link-btn danger-text" onClick={() => remove(a)}>Delete</button>
                        )}
                      </div>
                      {editing ? (
                        <textarea rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} aria-label="Edit update" maxLength={4000} />
                      ) : (
                        <div className="activity-body">{a.body}</div>
                      )}
                    </div>
                  );
                })}
          </div>
        </>
      )}
    </div>
  );
}
