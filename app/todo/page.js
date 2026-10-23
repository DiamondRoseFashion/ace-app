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
import ProjectPicker from '@/components/ProjectPicker';
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

const EMPTY = { title: '', note: '', due_date: '', priority: 'normal', assigned_to: '', project_id: '', remind_date: '', remind_time: '', remind_repeat: 'none', remind_until: '' };
const DONE_KEEP_DAYS = 7; // finished to-dos stay in "Done" this long

// "Remind me" (local date + time boxes) <-> stored timestamp
const pad = (n) => String(n).padStart(2, '0');
function splitRemind(ts) {
  if (!ts) return { remind_date: '', remind_time: '' };
  const x = new Date(ts);
  return { remind_date: iso(x), remind_time: `${pad(x.getHours())}:${pad(x.getMinutes())}` };
}
function joinRemind(v) {
  if (!v.remind_date) return null;
  const x = new Date(`${v.remind_date}T${v.remind_time || '09:00'}:00`);
  if (Number.isNaN(x.getTime())) return null;
  // daily: start from the next time it comes round (never "late" on save)
  if (v.remind_repeat === 'daily') while (x.getTime() <= Date.now()) x.setDate(x.getDate() + 1);
  return x.toISOString();
}
const clock = (x) => { let h = x.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad(x.getMinutes())} ${ap}`; };
function remindLabel(ts, d) {
  const x = new Date(ts);
  const day = iso(x) === d.today ? 'Today' : iso(x) === d.tomorrow ? 'Tomorrow' : fmtDate(iso(x));
  return `${day} ${clock(x)}`;
}
function doneLabel(ts, d) {
  const x = new Date(ts);
  const day = iso(x) === d.today ? 'Today' : fmtDate(iso(x));
  return `${day} ${clock(x)}`;
}

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

  // newer columns (project name, repeat reminders) may not be added yet
  const noPname = useRef(false);
  const noRepeat = useRef(false);
  const [done, setDone] = useState([]); // finished in the last 7 days
  async function loadTodos() {
    const base = 'id, title, note, due_date, priority, assigned_to, project_id, created_by, created_at, remind_at, remind_sent_at, done_at, done_by, project:projects(id, name)';
    const colsNow = () => base + (noPname.current ? '' : ', project_name') + (noRepeat.current ? '' : ', remind_repeat, remind_until');
    const since = new Date(Date.now() - DONE_KEEP_DAYS * 86400000).toISOString();
    const fetchBoth = () => Promise.all([
      supabase.from('todos').select(colsNow()).is('done_at', null),
      supabase.from('todos').select(colsNow()).not('done_at', 'is', null).gte('done_at', since).order('done_at', { ascending: false }),
    ]);
    let [open, fin] = await fetchBoth();
    for (let i = 0; i < 2 && open.error && /project_name|remind_repeat|remind_until/.test(open.error.message); i++) {
      if (/project_name/.test(open.error.message)) noPname.current = true;
      if (/remind_repeat|remind_until/.test(open.error.message)) noRepeat.current = true;
      [open, fin] = await fetchBoth();
    }
    if (open.error) { if (/relation|does not exist|schema cache/i.test(open.error.message)) setMissing(true); return; }
    setTodos(open.data || []);
    setDone(fin.data || []);
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
      const [{ data: acc }, { data: projs }, { data: sup }] = await Promise.all([
        supabase.from('todo_access').select('user_id, person:profiles(full_name)'),
        supabase.from('projects').select('id, name').order('name'),
        supabase.rpc('my_support_projects'), // projects salesmen gave me on the Support page
      ]);
      setPeople((acc || []).map((a) => ({ id: a.user_id, name: (a.person?.full_name || '').trim() || 'Unnamed' }))
        .sort((a, b) => a.name.localeCompare(b.name)));
      const own = (projs || []).filter((p) => (p.name || '').trim()).map((p) => ({ id: p.id, name: p.name.trim(), support: false }));
      const ownIds = new Set(own.map((p) => p.id));
      const helped = (sup || []).filter((r) => !ownIds.has(r.project_id) && (r.project_name || '').trim())
        .map((r) => ({ id: r.project_id, name: r.project_name.trim(), support: true }));
      setProjects([...own, ...helped].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
      await loadTodos();
      ch = supabase.channel(`todos-${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => loadTodos())
        .subscribe();
    })();
    const onFocus = () => loadTodos();
    window.addEventListener('focus', onFocus);
    const onSw = (e) => { if (e.data?.type === 'ace-todo') loadTodos(); };
    try { navigator.serviceWorker?.addEventListener('message', onSw); } catch { /* ignore */ }
    return () => {
      if (ch) supabase.removeChannel(ch);
      window.removeEventListener('focus', onFocus);
      try { navigator.serviceWorker?.removeEventListener('message', onSw); } catch { /* ignore */ }
      clearTimeout(undoTimer.current);
    };
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
      ...(noPname.current ? {} : { project_name: projectNameFor(form.project_id) }),
      remind_at: joinRemind(form),
      ...repeatFields(form),
    };
    const { error } = await supabase.from('todos').insert(row);
    setSaving(false);
    if (error) { setMsg({ ok: false, text: `Could not add: ${error.message}` }); return; }
    setForm({ ...EMPTY, assigned_to: me, priority: form.priority });
    if (row.assigned_to !== me) setTab('assigned');
    titleRef.current?.focus();
    loadTodos();
  }

  // saved with the to-do, so the person doing it sees the name even
  // if they can't open that project
  function projectNameFor(id, old) {
    if (!id) return null;
    return projects.find((p) => p.id === id)?.name || (old?.project_id === id ? old.project_name || old.project?.name : null) || null;
  }

  function repeatFields(v) {
    if (noRepeat.current) return {};
    const daily = v.remind_date && v.remind_repeat === 'daily';
    return { remind_repeat: daily ? 'daily' : 'none', remind_until: daily && v.remind_until ? v.remind_until : null };
  }

  async function markDone(t) {
    setTodos((list) => list.filter((x) => x.id !== t.id));
    const { error } = await supabase.from('todos').update({ done_at: new Date().toISOString() }).eq('id', t.id);
    if (error) { setMsg({ ok: false, text: `Could not mark done: ${error.message}` }); loadTodos(); return; }
    clearTimeout(undoTimer.current);
    setUndo({ id: t.id, title: t.title });
    undoTimer.current = setTimeout(() => setUndo(null), 7000);
    loadTodos();
  }

  async function notDone(t) {
    setDone((list) => list.filter((x) => x.id !== t.id));
    const { error } = await supabase.from('todos').update({ done_at: null }).eq('id', t.id);
    if (error) setMsg({ ok: false, text: `Could not move it back: ${error.message}` });
    loadTodos();
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
    setEdit({ title: t.title, note: t.note || '', due_date: t.due_date || '', priority: t.priority, assigned_to: t.assigned_to, project_id: t.project_id || '', ...splitRemind(t.remind_at), remind_repeat: t.remind_repeat || 'none', remind_until: t.remind_until || '' });
  }

  async function saveEdit() {
    if (!edit.title.trim()) return;
    const { error } = await supabase.from('todos').update({
      title: edit.title.trim(), note: edit.note.trim() || null, due_date: edit.due_date || null,
      priority: edit.priority, assigned_to: edit.assigned_to, project_id: edit.project_id || null,
      ...(noPname.current ? {} : { project_name: projectNameFor(edit.project_id, todos.find((x) => x.id === editId)) }),
      remind_at: joinRemind(edit),
      ...repeatFields(edit),
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
  const list = (tab === 'mine' ? mine : tab === 'done' ? done : assigned).filter((t) => {
    const q = search.trim().toLowerCase();
    return (!prio || t.priority === prio)
      && (!q || [t.title, t.note, t.project?.name, t.project_name].some((v) => String(v || '').toLowerCase().includes(q)));
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
      <div className="td-flabel">Project (optional)
        <ProjectPicker value={v.project_id} onChange={(id) => set({ ...v, project_id: id })} options={projects} placeholder="Type to search projects…" />
      </div>
      <div className="td-remind">
        <span className="td-remind-label">⏰ Remind {v.assigned_to && v.assigned_to !== me ? 'them' : 'me'} (notification)</span>
        <div className="td-remind-row">
          <span className="td-mini">{v.remind_repeat === 'daily' ? 'From' : 'Date'}
            <DateInput aria-label={v.remind_repeat === 'daily' ? 'Reminder start date' : 'Reminder date'} value={v.remind_date} onChange={(e) => set({ ...v, remind_date: e.target.value, remind_time: v.remind_time || '09:00' })} />
          </span>
          <span className="td-mini">Time
            <input type="time" aria-label="Reminder time" value={v.remind_time} onChange={(e) => set({ ...v, remind_time: e.target.value, remind_date: v.remind_date || dayInfo().today })} />
          </span>
          {!noRepeat.current && (
            <span className="td-mini">Repeat
              <select aria-label="Repeat reminder" value={v.remind_repeat || 'none'}
                onChange={(e) => set({ ...v, remind_repeat: e.target.value, remind_date: v.remind_date || dayInfo().today, remind_time: v.remind_time || '09:00' })}>
                <option value="none">Once</option>
                <option value="daily">Every day</option>
              </select>
            </span>
          )}
          {v.remind_repeat === 'daily' && (
            <span className="td-mini">Until (optional)
              <DateInput aria-label="Repeat until" value={v.remind_until} min={v.remind_date || undefined} onChange={(e) => set({ ...v, remind_until: e.target.value })} />
            </span>
          )}
        </div>
        <div className="td-presets">
          <button type="button" onClick={() => { const x = new Date(Date.now() + 3600000); set({ ...v, remind_date: iso(x), remind_time: `${pad(x.getHours())}:${pad(x.getMinutes())}`, remind_repeat: 'none' }); }}>In 1 hour</button>
          <button type="button" onClick={() => set({ ...v, remind_date: dayInfo().tomorrow, remind_time: '09:00' })}>Tomorrow 9 AM</button>
          {!noRepeat.current && <button type="button" onClick={() => set({ ...v, remind_date: v.remind_date || dayInfo().today, remind_time: v.remind_time || '09:00', remind_repeat: 'daily' })}>🔁 Every day</button>}
          {v.due_date && <button type="button" onClick={() => set({ ...v, remind_date: v.due_date, remind_time: '09:00' })}>Due date 9 AM</button>}
          {v.remind_date && <button type="button" className="td-clear" onClick={() => set({ ...v, remind_date: '', remind_time: '', remind_repeat: 'none', remind_until: '' })}>No reminder</button>}
        </div>
        {v.remind_repeat === 'daily' && v.remind_date && (
          <span className="td-remind-hint">🔁 Reminds every day at {v.remind_time ? clock(new Date(`2000-01-01T${v.remind_time}:00`)) : '9:00 AM'}, from {fmtDate(v.remind_date)}{v.remind_until ? ` until ${fmtDate(v.remind_until)}` : ' until the to-do is done'}.</span>
        )}
      </div>
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
          Add what needs doing, set a due date, who does it and a reminder. Tick the circle when it&apos;s done: it moves to ✓ Done for 7 days.
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
                  <button type="button" role="tab" aria-selected={tab === 'done'} className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>
                    ✓ Done <span className="sp-count">{done.length}</span>
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

              {tab === 'done' && list.length > 0 && (
                <div className="td-done-note">Finished to-dos stay here for {DONE_KEEP_DAYS} days, then they are deleted automatically.</div>
              )}
              {list.length === 0 ? (
                <div className="sp-empty">
                  {search || prio ? 'No to-dos match.' : tab === 'mine' ? '🎉 Nothing to do. Add a to-do above.' : tab === 'done' ? 'No finished to-dos in the last 7 days.' : 'You haven’t given a to-do to anyone.'}
                </div>
              ) : tab === 'done' ? list.map((t) => {
                const goes = new Date(new Date(t.done_at).getTime() + DONE_KEEP_DAYS * 86400000);
                const canDelete = t.created_by === me || t.assigned_to === me;
                const pname = t.project?.name || t.project_name;
                return (
                  <div key={t.id} className="td-item td-done">
                    <div className="td-line">
                      <button type="button" className="td-check checked" onClick={() => notDone(t)} title="Not done: move it back to the list" aria-label={`Mark "${t.title}" not done`}>
                        <span>✓</span>
                      </button>
                      <div className="td-main" style={{ cursor: 'default' }}>
                        <div className="td-title">{t.title}</div>
                        <div className="td-meta">
                          <span className="td-done-by">✅ Done{t.done_by ? ` by ${nameOf(t.done_by)}` : ''} · {doneLabel(t.done_at, d)}</span>
                          {pname && <span className="td-proj-plain">📁 {pname}</span>}
                          {t.assigned_to !== me && <span className="td-who">👤 For {nameOf(t.assigned_to)}</span>}
                          {t.created_by !== me && <span className="td-who">👤 From {nameOf(t.created_by)}</span>}
                          <span className="td-goes">🗑 Deletes {fmtDate(iso(goes))}</span>
                        </div>
                      </div>
                      {confirmDel === t.id ? (
                        <span className="td-confirm">Delete?
                          <button type="button" className="btn btn-danger" onClick={() => remove(t.id)}>Yes</button>
                          <button type="button" className="btn btn-ghost" onClick={() => setConfirmDel(null)}>No</button>
                        </span>
                      ) : (
                        <>
                          <button type="button" className="btn btn-ghost td-edit-btn" onClick={() => notDone(t)}>↩ Not done</button>
                          {canDelete && <button type="button" className="btn btn-ghost td-edit-btn td-del-btn" onClick={() => setConfirmDel(t.id)}>🗑 Delete</button>}
                        </>
                      )}
                    </div>
                  </div>
                );
              }) : GROUPS.filter((g) => grouped[g.key]?.length).map((g) => (
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
                              {t.remind_at && (t.remind_repeat === 'daily' ? (
                                <span className={`td-rem${t.remind_sent_at ? ' sent' : ''}`} title={t.remind_sent_at ? 'Daily reminders finished' : `Next: ${remindLabel(t.remind_at, d)}`}>
                                  🔁 Daily {clock(new Date(t.remind_at))}{t.remind_until ? ` · until ${fmtDate(t.remind_until)}` : ''}{t.remind_sent_at ? ' · ended' : ''}
                                </span>
                              ) : (
                                <span className={`td-rem${t.remind_sent_at ? ' sent' : ''}`} title={t.remind_sent_at ? 'Reminder sent' : 'Reminder set'}>{t.remind_sent_at ? '🔔 Reminded ' : '⏰ '}{remindLabel(t.remind_at, d)}</span>
                              ))}
                              {t.project_id && (t.project?.name || t.project_name) && (
                                t.project ? (
                                  <Link href={`/project/${t.project.id}`} className="td-proj" onClick={(e) => e.stopPropagation()}>📁 {t.project.name}</Link>
                                ) : projects.some((p) => p.id === t.project_id && p.support) ? (
                                  <Link href="/support" className="td-proj" onClick={(e) => e.stopPropagation()} title="Open on the Support page">📁 {t.project_name}</Link>
                                ) : <span className="td-proj-plain">📁 {t.project_name}</span>
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
