'use client';

// Notes written by a project's supporters ("Supported By" people).
// canAdd: the signed-in person is a supporter and may add notes.
// Notes are permanent: nobody can edit or delete them.
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';
import { fmtDateTime } from '@/lib/dates';

export default function SupportNotes({ projectId, canAdd = false, emptyText = 'No support notes yet.' }) {
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [missing, setMissing] = useState(false);

  async function load() {
    const { data, error } = await supabase
      .from('support_notes')
      .select('id, body, created_at, author_id, author:profiles!author_id(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) { if (/relation|schema cache|does not exist/i.test(error.message)) setMissing(true); }
    else setNotes(data || []);
    setLoading(false);
  }

  useEffect(() => {
    if (!projectId) return undefined;
    load();
    const ch = supabase
      .channel(`support-notes-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_notes', filter: `project_id=eq.${projectId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function add() {
    if (!draft.trim()) return;
    setSaving(true); setMsg(null);
    const { error } = await supabase.from('support_notes').insert({ project_id: projectId, body: draft.trim() });
    setSaving(false);
    if (error) { setMsg({ ok: false, text: error.message }); return; }
    setDraft('');
    setMsg({ ok: true, text: 'Note saved.' });
    load();
  }

  if (missing) return <div className="notice err" style={{ margin: 0 }}>Support notes need a one-time database update. Please ask your admin.</div>;

  return (
    <div className="support-notes">
      {canAdd && (
        <div className="sn-add">
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMsg(null); }}
            placeholder="Write what you did to support this project: calls, site visits, documents sent…"
            maxLength={4000}
            aria-label="New support note"
          />
          <div className="sn-add-row">
            <span className="sn-hint">Saved notes can’t be edited or deleted.</span>
            <button type="button" className="btn btn-primary" onClick={add} disabled={saving || !draft.trim()}>
              {saving ? 'Saving…' : 'Add Note'}
            </button>
          </div>
          {msg && <div className={msg.ok ? 'notice ok' : 'notice err'} style={{ marginTop: 8, marginBottom: 0 }}>{msg.text}</div>}
        </div>
      )}
      <div className="activity-list">
        {loading ? <div className="activity-empty">Loading…</div>
          : notes.length === 0 ? <div className="activity-empty">{emptyText}</div>
            : notes.map((n) => (
              <div key={n.id} className="activity-item">
                <div className="activity-meta">
                  <strong>{n.author?.full_name || 'Someone'}</strong>
                  <span> · {fmtDateTime(n.created_at)}</span>
                </div>
                <div className="activity-body">{n.body}</div>
              </div>
            ))}
      </div>
    </div>
  );
}
