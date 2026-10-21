'use client';

// To-Do: a simple task list (like Microsoft To Do / Todoist).
//  • Add a to-do with a due date, priority, who does it and an
//    optional linked project.
//  • "My to-dos" = assigned to me. "Assigned by me" = ones I gave to
//    someone else.
//  • Ticking the circle marks it done and takes it off the list
//    (Undo for a few seconds).
//  • Only people given To-Do access can open this page.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import DateInput from '@/components/DateInput';
import { fmtDate } from '@/lib/dates';

const PRIORITIES = [
  { v: 'high', label: 'High' },
  { v: 'normal', label: 'Normal' },
  { v: 'low', label: 'Low' },
];
const P_RANK = { high: 0, normal: 1, low: 2 };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function dayInfo() {
  const t = new Date();
  const tom = new Date(t); tom.setDate(t.getDate() + 1);
  const wk = new Date(t); wk.setDate(t.getDate() + 7);
  return { today: iso(t), tomorrow: iso(tom), week: iso(wk) };
}

function groupOf(due, d) {
  if (!due) return 'none';
  if (due < d.today) return 'overdue';
  if (due === d.today) return 'today';
  if (due === d.tomorrow) return 'tomorrow';
  if (due <= d.week) return 'week';
  return 'later';
}
const GROUPS = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
];

function dueLabel(due, d) {
  if (!due) return '';
  if (due === d.today) return 'Today';
  if (due === d.tomorrow) return 'Tomorrow';
  return fmtDate(due);
}

const EMPTY = { title: '', note: '', due_date: '', priority: 'normal', assigned_to: '', project_id: '' };

export default function TodoPage() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [me, setMe] = useState(null);
  const [allowed, setAllowed] = useState(null); // null = checking
  const [missing, setMissing] = useState(false);
  const [todos, setTodos] = useState([]);
  const [people, setPeople] = useState([]); // people with To-Do access
  const [projects, setProjects] = useState([]);
  const [tab, setTab] = useState('mine');
  const [search, setSearch] = useState('');
  const [prio, setPrio] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(EMPTY);
  const [confirmDel, setConfirmDel] = useState(null);
  const [undo, setUndo] = useState(null); // { id, title }
  const undoTimer = useRef(null);
  const titleRef = useRef(null);

  async function loadTodos() {
    const { data, error } = await supabase
      .from('todos')
      .select('id, title, note, due_date, priority, assigned_to, project_id, created_by, created_at, project:projects(id, name)')
      .is('done_at', null);
    if (error) { if (/relation|does not exist|schema cache/i.test(error.message)) setMissing(true); return; }
    setTodos(data || []);
  }

  useEffect(() => {
    let ch = null;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      setMe(user.id);
      const { data: ok, error } = await supabase.rpc('has_todo_access');
      if (error) { setMissing(true); setAllowed(false); return; }
      setAllowed(!!ok);
      if (!ok) return;
      setForm((f) => ({ ...f, assigned_to: user.id }));
      const [{ data: acc }, { data: projs }] = await Promise.all([
        supabase.from('todo_access').select('user_id, person:profiles(full_name)'),
        supabase.from('projects').select('id, name').order('name'),
      ]);
      setPeople((acc || []).map((a) => ({ id: a.user_id, name: (a.person?.full_name || '').trim() || 'Unnamed' }))
        .sort((a, b) => a.name.localeCompare(b.name)));
      setProjects((projs || []).filter((p) => (p.name || '').trim()));
      await loadTodos();
      ch = supabase.channel(`todos-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => loadTodos())
        .subscribe();
    })();
    const onFocus = () => loadTodos();
    window.addEventListener('focus', onFocus);
    return () => { if (ch) supabase.removeChannel(ch); window.removeEventListener('focus', onFocus); clearTimeout(undoTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nameOf = (id) => (id === me ? 'Me' : people.find((p) => p.id === id)?.name || 'Someone');

  async function add(e) {
    e?.preventDefault();
    if (!form.title.trim() || saving) return;
    setSaving(true); setMsg(null);
    const row = {
      title: form.title.trim(),
      note: form.note.trim() || null,
      due_date: form.due_date || null,
      priority: form.priority,
      assigned_to: form.assigned_to || me,
      project_id: form.project_id || null,
    };
    const { error } = await supabase.from('todos').insert(row);
    setSaving(false);
    if (error) { setMsg({ ok: false, text: `Could not add: ${error.message}` }); return; }
    setForm({ ...EMPTY, assigned_to: me, priority: form.priority });
    if (row.assigned_to !== me) setTab('assigned');
    titleRef.current?.focus();
    loadTodos();
  }

  async function markDone(t) {
    setTodos((list) => list.filter((x) => x.id !== t.id));
    const { error } = await supabase.from('todos').update({ done_at: new Date().toISOString() }).eq('id', t.id);
    if (error) { setMsg({ ok: false, text: `Could not mark done: ${error.message}` }); loadTodos(); return; }
    clearTimeout(undoTimer.current);
    setUndo({ id: t.id, title: t.title });
    undoTimer.current = setTimeout(() => setUndo(null), 7000);
  }

  async function undoDone() {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    await supabase.from('todos').update({ done_at: null }).eq('id', undo.id);
    setUndo(null);
    loadTodos();
  }

  function startEdit(t) {
    setConfirmDel(null);
    if (editId === t.id) { setEditId(null); return; }
    setEditId(t.id);
    setEdit({ title: t.title, note: t.note || '', due_date: t.due_date || '', priority: t.priority, assigned_to: t.assigned_to, project_id: t.project_id || '' });
  }

  async function saveEdit() {
    if (!edit.title.trim()) return;
    const { error } = await supabase.from('todos').update({
      title: edit.title.trim(), note: edit.note.trim() || null, due_date: edit.due_date || null,
      priority: edit.priority, assigned_to: edit.assigned_to, project_id: edit.project_id || null,
    }).eq('id', editId);
    if (error) { setMsg({ ok: false, text: `Could not save: ${error.message}` }); return; }
    setEditId(null);
    loadTodos();
  }

  async function remove(id) {
    const { error } = await supabase.from('todos').delete().eq('id', id);
    if (error) { setMsg({ ok: false, text: `Could not delete: ${error.message}` }); return; }
    setConfirmDel(null); setEditId(null);
    loadTodos();
  }

  const d = dayInfo();
  const mine = todos.filter((t) => t.assigned_to === me);
  const assigned = todos.filter((t) => t.created_by === me && t.assigned_to !== me);
  const list = (tab === 'mine' ? mine : assigned).filter((t) => {
    const q = search.trim().toLowerCase();
    return (!prio || t.priority === prio)
      && (!q || [t.title, t.note, t.project?.name].some((v) => String(v || '').toLowerCase().includes(q)));
  });
  const grouped = (() => {
    const g = {};
    for (const t of list) (g[groupOf(t.due_date, d)] ||= []).push(t);
    for (const k of Object.keys(g)) {
      g[k].sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))
        || P_RANK[a.priority] - P_RANK[b.priority]
        || String(a.created_at).localeCompare(String(b.created_at)));
    }
    return g;
  })();
  const dueSoon = mine.filter((t) => t.due_date && t.due_date <= d.today).length;
  // keep the sidebar badge in step
  useEffect(() => { if (allowed) window.dispatchEvent(new CustomEvent('ace-todo-due', { detail: dueSoon })); }, [dueSoon, allowed]);

  const fields = (v, set) => (
    <div className="td-fields">
      <label>Due date
        <DateInput aria-label="Due date" value={v.due_date} onChange={(e) => set({ ...v, due_date: e.target.value })} />
      </label>
      <label>Priority
        <select value={v.priority} onChange={(e) => set({ ...v, priority: e.target.value })}>
          {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
      </label>
      <label>Assign to
        <select value={v.assigned_to} onChange={(e) => set({ ...v, assigned_to: e.target.value })}>
          {people.map((p) => <option key={p.id} value={p.id}>{p.id === me ? `Me (${p.name})` : p.name}</option>)}
        </select>
      </label>
      <label>Project (optional)
        <select value={v.project_id} onChange={(e) => set({ ...v, project_id: e.target.value })}>
          <option value="">— None —</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="td-note-field">Note (optional)
        <textarea rows={2} value={v.note} onChange={(e) => set({ ...v, note: e.target.value })} placeholder="Details, phone numbers, links…" />
      </label>
    </div>
  );

  return (
    <div className="shell">
      <Sidebar active="todo" />
      <div className="main">
        <div className="eyebrow">Tasks</div>
        <h1 style={{ fontSize: 30, marginTop: 4, marginBottom: 6 }}>To-Do</h1>
        <p style={{ color: 'rgba(255,255,255,.75)', marginTop: 0, marginBottom: 20 }}>
          Add what needs doing, set a due date and who does it. Tick the circle when it&apos;s done and it leaves the list.
        </p>

        {allowed === null ? (
          <div className="card"><div className="activity-empty">Loading…</div></div>
        ) : missing ? (
          <div className="card"><div className="notice err" style={{ margin: 0 }}>To-Do needs a one-time database update. Please ask your admin.</div></div>
        ) : !allowed ? (
          <div className="card"><div className="notice" style={{ margin: 0 }}>To-Do isn&apos;t turned on for your account yet.</div></div>
        ) : (
          <>
            <form className="card td-add" onSubmit={add}>
              <div className="td-add-row">
                <span className="td-plus" aria-hidden="true">＋</span>
                <input
                  ref={titleRef}
                  className="td-title-input"
                  placeholder="Add a to-do… (press Enter)"
                  value={form.title}
                  maxLength={300}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  aria-label="New to-do"
                />
                <button type="button" className="btn btn-ghost td-more" onClick={() => setShowMore((s) => !s)}>
                  {showMore ? 'Fewer options ▴' : 'Date, priority, person ▾'}
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || !form.title.trim()}>{saving ? 'Adding…' : 'ADD +'}</button>
              </div>
              {showMore && fields(form, setForm)}
              {msg && <div className={msg.ok ? 'notice ok' : 'notice err'} style={{ marginTop: 10, marginBottom: 0 }}>{msg.text}</div>}
            </form>

            <div className="card" style={{ padding: 0 }}>
              <div className="td-bar">
                <div className="td-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
                    My to-dos <span className="sp-count">{mine.length}</span>
                    {dueSoon > 0 && <span className="td-due-pill">{dueSoon} due</span>}
                  </button>
                  <button type="button" role="tab" aria-selected={tab === 'assigned'} className={tab === 'assigned' ? 'on' : ''} onClick={() => setTab('assigned')}>
                    Assigned by me <span className="sp-count">{assigned.length}</span>
                  </button>
                </div>
                <div className="td-filters">
                  <input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search to-dos" />
                  <select value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Filter priority">
                    <option value="">All priorities</option>
                    {PRIORITIES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                  </select>
                </div>
              </div>

              {list.length === 0 ? (
                <div className="sp-empty">
                  {search || prio ? 'No to-dos match.' : tab === 'mine' ? '🎉 Nothing to do. Add a to-do above.' : 'You haven’t given a to-do to anyone.'}
                </div>
              ) : GROUPS.filter((g) => grouped[g.key]?.length).map((g) => (
                <div key={g.key} className={`td-group td-g-${g.key}`}>
                  <div className="td-group-head">{g.label} <span>{grouped[g.key].length}</span></div>
                  {grouped[g.key].map((t) => {
                    const open = editId === t.id;
                    const late = t.due_date && t.due_date < d.today;
                    const who = tab === 'mine'
                      ? (t.created_by !== me ? `From ${nameOf(t.created_by)}` : '')
                      : `For ${nameOf(t.assigned_to)}`;
                    return (
                      <div key={t.id} className={`td-item${open ? ' open' : ''}`}>
                        <div className="td-line">
                          <button type="button" className={`td-check p-${t.priority}`} onClick={() => markDone(t)} title="Mark done" aria-label={`Mark "${t.title}" done`}>
                            <span>✓</span>
                          </button>
                          <div className="td-main" onClick={() => startEdit(t)} role="button" tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter') startEdit(t); }}>
                            <div className="td-title">{t.title}</div>
                            <div className="td-meta">
                              {t.priority !== 'normal' && <span className={`td-prio p-${t.priority}`}>{t.priority === 'high' ? '● High' : '● Low'}</span>}
                              {t.due_date && <span className={`td-due${late ? ' late' : ''}`}>📅 {dueLabel(t.due_date, d)}</span>}
                              {t.project && (
                                <Link href={`/project/${t.project.id}`} className="td-proj" onClick={(e) => e.stopPropagation()}>📁 {t.project.name}</Link>
                              )}
                              {who && <span className="td-who">👤 {who}</span>}
                              {t.note && !open && <span className="td-note-prev">📝 {t.note}</span>}
                            </div>
                          </div>
                          <button type="button" className="btn btn-ghost td-edit-btn" onClick={() => startEdit(t)}>{open ? 'Close' : 'Edit'}</button>
                        </div>
                        {open && (
                          <div className="td-edit">
                            <input value={edit.title} maxLength={300} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label="To-do title" />
                            {fields(edit, setEdit)}
                            <div className="td-edit-actions">
                              {t.created_by === me && (confirmDel === t.id ? (
                                <span className="td-confirm">Delete this to-do?
                                  <button type="button" className="btn btn-danger" onClick={() => remove(t.id)}>Yes, delete</button>
                                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmDel(null)}>No</button>
                                </span>
                              ) : (
                                <button type="button" className="link-btn td-del" onClick={() => setConfirmDel(t.id)}>Delete</button>
                              ))}
                              <span style={{ flex: 1 }} />
                              <button type="button" className="btn btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
                              <button type="button" className="btn btn-primary" onClick={saveEdit} disabled={!edit.title.trim()}>Save</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}

        {undo && (
          <div className="support-toast td-toast" role="status">
            <span className="st-icon">✅</span>
            <div className="st-text"><strong>Done</strong><span>{undo.title}</span></div>
            <button type="button" className="btn btn-ghost" onClick={undoDone}>Undo</button>
          </div>
        )}
      </div>
    </div>
  );
}
