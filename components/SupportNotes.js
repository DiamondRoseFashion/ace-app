'use client';

// Notes written by a project's supporters ("Supported By" people).
// canAdd: the signed-in person is a supporter and may add notes.
// Notes are permanent: nobody can edit or delete them.
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabaseClient';
import { fmtDate } from '@/lib/dates';
import { printNotes } from '@/lib/printNotes';

const timeOf = (v) => { const d = new Date(v); const h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

export default function SupportNotes({ projectId, canAdd = false, emptyText = 'No notes yet.', placeholder = 'Write a note about this project: calls, site visits, documents sent…', printInfo = null }) {
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

  const renderNote = (n) => (
    <div key={n.id} className="activity-item">
      <div className="activity-meta">
        <strong>{n.author?.full_name || 'Someone'}</strong>
        <span className="sn-when">📅 {fmtDate(n.created_at)} &nbsp;🕒 {timeOf(n.created_at)}</span>
      </div>
      <div className="activity-body">{n.body}</div>
    </div>
  );

  if (missing) return <div className="notice err" style={{ margin: 0 }}>Project notes need a one-time database update. Please ask your admin.</div>;

  return (
    <div className="support-notes">
      {canAdd && (
        <div className="sn-add">
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setMsg(null); }}
            placeholder={placeholder}
            maxLength={4000}
            aria-label="New project note"
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
      {notes.length > 0 && (
        <div className="sn-print-row">
          <button type="button" className="btn btn-ghost sn-print" onClick={() => printNotes(notes, printInfo || {})} title="Print only these notes">
            🖨 Print notes
          </button>
        </div>
      )}
      <div className="activity-list">
        {loading ? <div className="activity-empty">Loading…</div>
          : notes.length === 0 ? <div className="activity-empty">{emptyText}</div>
            : (
              <>
                {notes.slice(0, 4).map(renderNote)}
                {notes.length > 4 && (
                  <div className="sn-older">
                    <div className="sn-older-head">Older notes ({notes.length - 4}) · scroll to see more</div>
                    <div className="sn-older-list">{notes.slice(4).map(renderNote)}</div>
                  </div>
                )}
              </>
            )}
      </div>
    </div>
  );
}
