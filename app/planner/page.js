'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import {
  MANAGEMENT_ROLES, REMINDER_OPTIONS, reminderLabel,
  todayKey, addDays, weekDays, parseKey, formatTime, formatDayLong, formatDayShort,
  meetingTitle, initials, getPref, setPref, notifyMeetingsChanged, friendlyDbError,
} from '@/lib/planner';

const SELECT = '*, project:projects(id, name), assignee:profiles!assigned_to(id, full_name)';

function emptyForm(date, assignedTo) {
  return {
    id: null, title: '', meeting_date: date, start_time: '', end_time: '',
    venue: '', project_id: '', assigned_to: assignedTo || '', reminder_minutes: '',
    notes: '', actions: '',
  };
}

function toForm(m) {
  return {
    id: m.id,
    title: m.title || '',
    meeting_date: m.meeting_date || todayKey(),
    start_time: m.start_time ? m.start_time.slice(0, 5) : '',
    end_time: m.end_time ? m.end_time.slice(0, 5) : '',
    venue: m.venue || '',
    project_id: m.project_id || '',
    assigned_to: m.assigned_to || '',
    reminder_minutes: m.reminder_minutes == null ? '' : String(m.reminder_minutes),
    notes: m.notes || '',
    actions: m.actions || '',
  };
}

function partOfDay(m) {
  if (!m.start_time) return 'Anytime';
  const h = Number(m.start_time.slice(0, 2));
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

function sortMeetings(list) {
  return [...list].sort((a, b) => {
    if (a.meeting_date !== b.meeting_date) return a.meeting_date < b.meeting_date ? -1 : 1;
    if (!a.start_time && b.start_time) return 1;
    if (a.start_time && !b.start_time) return -1;
    return (a.start_time || '') < (b.start_time || '') ? -1 : 1;
  });
}

export default function PlannerPage() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [me, setMe] = useState(null); // { id, role, full_name, reminder_default_minutes }
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState('day');
  const [date, setDate] = useState(todayKey());
  const [who, setWho] = useState('mine');
  const [meetings, setMeetings] = useState([]);
  const [carryOver, setCarryOver] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  const [quickTitle, setQuickTitle] = useState('');
  const [quickTime, setQuickTime] = useState('');
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const isManager = MANAGEMENT_ROLES.includes(me?.role);
  const today = todayKey();
  const days = useMemo(() => weekDays(date), [date]);
  // always load the whole week so the day strip can show which days have meetings
  const rangeFrom = days[0];
  const rangeTo = days[6];

  // who we're viewing: 'mine' | 'all' | <profile id>
  const filterId = who === 'mine' ? me?.id : who === 'all' ? null : who;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: prof } = await supabase
        .from('profiles').select('id, role, full_name, reminder_default_minutes').eq('id', user.id).single();
      const profile = prof || { id: user.id, role: 'employee', full_name: user.email };
      setMe(profile);
      const [{ data: projs }, { data: ppl }] = await Promise.all([
        supabase.from('projects').select('id, name').order('name'),
        MANAGEMENT_ROLES.includes(profile.role)
          ? supabase.from('profiles').select('id, full_name, role').order('full_name')
          : Promise.resolve({ data: [] }),
      ]);
      setProjects(projs || []);
      setPeople(ppl || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMeetings() {
    if (!me) return;
    setPageError('');
    let q = supabase.from('meetings').select(SELECT)
      .gte('meeting_date', rangeFrom).lte('meeting_date', rangeTo);
    if (filterId) q = q.eq('assigned_to', filterId);
    const { data, error } = await q;
    if (error) { setPageError(friendlyDbError(error.message)); setLoading(false); return; }
    setMeetings(sortMeetings(data || []));

    // Any.do-style "still to do": your own unfinished meetings from the last week
    if (view === 'day' && date === today && who === 'mine') {
      const { data: past } = await supabase.from('meetings').select(SELECT)
        .eq('assigned_to', me.id).eq('is_done', false).not('start_time', 'is', null)
        .gte('meeting_date', addDays(today, -7)).lt('meeting_date', today);
      setCarryOver(sortMeetings(past || []));
    } else {
      setCarryOver([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, view, rangeFrom, date === today, who]);

  useEffect(() => {
    const onChange = () => loadMeetings();
    window.addEventListener('ace-meetings-changed', onChange);
    return () => window.removeEventListener('ace-meetings-changed', onChange);
  });

  // ---------- actions ----------
  async function toggleDone(m) {
    const next = !m.is_done;
    const patch = (list) => list.map((x) => (x.id === m.id ? { ...x, is_done: next } : x));
    setMeetings(patch);
    setCarryOver(patch);
    const { error } = await supabase.from('meetings').update({ is_done: next }).eq('id', m.id);
    if (error) { setPageError(friendlyDbError(error.message)); loadMeetings(); return; }
    notifyMeetingsChanged();
  }

  async function quickAdd(e) {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    const payload = {
      title: quickTitle.trim(),
      meeting_date: date,
      start_time: quickTime || null,
    };
    if (isManager && filterId && filterId !== me.id) payload.assigned_to = filterId;
    const { error } = await supabase.from('meetings').insert(payload);
    if (error) { setPageError(friendlyDbError(error.message)); return; }
    setQuickTitle('');
    setQuickTime('');
    notifyMeetingsChanged();
    loadMeetings();
  }

  function openNew(forDate) {
    setFormError('');
    setConfirmDelete(false);
    const assignee = isManager && filterId ? filterId : me.id;
    setForm(emptyForm(forDate || date, assignee));
  }

  function openEdit(m) {
    setFormError('');
    setConfirmDelete(false);
    setForm(toForm(m));
  }

  async function saveForm(e) {
    e.preventDefault();
    setFormError('');
    if (!form.title.trim()) { setFormError('Please give the meeting a title.'); return; }
    if (!form.meeting_date) { setFormError('Please pick a date.'); return; }
    if (form.start_time && form.end_time && form.end_time <= form.start_time) {
      setFormError('The end time must be after the start time.');
      return;
    }
    const payload = {
      title: form.title.trim(),
      meeting_date: form.meeting_date,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      venue: form.venue.trim() || null,
      project_id: form.project_id || null,
      reminder_minutes: form.reminder_minutes === '' ? null : Number(form.reminder_minutes),
      notes: form.notes.trim() || null,
      actions: form.actions.trim() || null,
    };
    if (isManager && form.assigned_to) payload.assigned_to = form.assigned_to;

    setSaving(true);
    const { error } = form.id
      ? await supabase.from('meetings').update(payload).eq('id', form.id)
      : await supabase.from('meetings').insert(payload);
    setSaving(false);
    if (error) { setFormError(friendlyDbError(error.message)); return; }
    setForm(null);
    notifyMeetingsChanged();
    loadMeetings();
  }

  async function deleteMeeting() {
    if (!form?.id) return;
    setSaving(true);
    const { error } = await supabase.from('meetings').delete().eq('id', form.id);
    setSaving(false);
    if (error) { setFormError(friendlyDbError(error.message)); return; }
    setForm(null);
    notifyMeetingsChanged();
    loadMeetings();
  }

  // ---------- derived ----------
  const dayMeetings = meetings.filter((m) => m.meeting_date === date);
  const doneCount = dayMeetings.filter((m) => m.is_done).length;
  const groups = ['Morning', 'Afternoon', 'Evening', 'Anytime']
    .map((name) => ({ name, items: dayMeetings.filter((m) => partOfDay(m) === name) }))
    .filter((g) => g.items.length > 0);
  const countByDay = useMemo(() => {
    const map = {};
    meetings.forEach((m) => { map[m.meeting_date] = (map[m.meeting_date] || 0) + 1; });
    return map;
  }, [meetings]);
  const showAssignee = isManager && who !== 'mine';

  const heading = view === 'week'
    ? `${parseKey(days[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${parseKey(days[6]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : date === today ? (who === 'mine' ? 'My Day' : 'Today') : formatDayLong(date);

  if (!me) {
    return <div className="shell"><Sidebar active="planner" /><div className="main">Loading…</div></div>;
  }

  return (
    <div className="shell">
      <Sidebar active="planner" />
      <div className="main planner">
        <div className="page-header">
          <div>
            <div className="eyebrow">Meetings Planner</div>
            <h1 style={{ fontSize: 30, marginTop: 4 }}>{heading}</h1>
            {view === 'day' && date === today && (
              <div className="planner-sub">{formatDayLong(today)}</div>
            )}
          </div>
          <div className="header-actions">
            <div className="seg" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === 'day'} className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Day</button>
              <button role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Week</button>
            </div>
            <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙️ Reminders</button>
            <button className="btn btn-primary" onClick={() => openNew()}>+ New meeting</button>
          </div>
        </div>

        {/* Date navigation */}
        <div className="planner-nav">
          <button className="nav-arrow" aria-label="Previous" onClick={() => setDate(addDays(date, view === 'week' ? -7 : -1))}>‹</button>
          <div className={`day-strip${view === 'week' ? ' week-mode' : ''}`}>
            {days.map((d) => (
              <button
                key={d}
                className={`day-chip${d === date && view === 'day' ? ' selected' : ''}${d === today ? ' today' : ''}`}
                onClick={() => { setDate(d); setView('day'); }}
              >
                <span className="dc-name">{formatDayShort(d)}</span>
                <span className="dc-num">{parseKey(d).getDate()}</span>
                <span className={`dc-dot${countByDay[d] ? ' has' : ''}`} />
              </button>
            ))}
          </div>
          <button className="nav-arrow" aria-label="Next" onClick={() => setDate(addDays(date, view === 'week' ? 7 : 1))}>›</button>
          {date !== today && <button className="btn btn-ghost today-btn" onClick={() => setDate(today)}>Today</button>}
          {isManager && (
            <select className="who-select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose meetings">
              <option value="mine">My meetings</option>
              <option value="all">Everyone</option>
              {people.filter((p) => p.id !== me.id).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || 'Unnamed'}</option>
              ))}
            </select>
          )}
        </div>

        {pageError && <div className="card planner-error">{pageError}</div>}

        {view === 'day' ? (
          <>
            {/* Quick add */}
            <form className="quick-add" onSubmit={quickAdd}>
              <span className="qa-plus" aria-hidden="true">＋</span>
              <input
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder={`Add a meeting for ${date === today ? 'today' : formatDayLong(date)}…`}
                aria-label="Meeting title"
              />
              <input type="time" value={quickTime} onChange={(e) => setQuickTime(e.target.value)} aria-label="Start time" className="qa-time" />
              <button className="btn btn-primary" disabled={!quickTitle.trim()}>Add</button>
            </form>

            {dayMeetings.length > 0 && (
              <div className="progress-row">
                <div className="progress-bar"><div style={{ width: `${(doneCount / dayMeetings.length) * 100}%` }} /></div>
                <span>{doneCount} of {dayMeetings.length} done</span>
              </div>
            )}

            {carryOver.length > 0 && (
              <>
                <div className="eyebrow planner-group">Still open from earlier</div>
                <div className="card meeting-list">
                  {carryOver.map((m) => (
                    <MeetingRow key={m.id} m={m} showDate showAssignee={false} onToggle={toggleDone} onOpen={openEdit} defaultReminder={me.reminder_default_minutes} meId={me.id} />
                  ))}
                </div>
              </>
            )}

            {loading ? (
              <div className="card" style={{ color: 'var(--muted)' }}>Loading…</div>
            ) : dayMeetings.length === 0 ? (
              <div className="card empty-day">
                <div className="empty-icon" aria-hidden="true">🗓️</div>
                <div className="empty-title">Nothing scheduled{date === today ? ' today' : ''}</div>
                <div className="empty-sub">Add a meeting above, or plan ahead in the week view.</div>
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.name}>
                  <div className="eyebrow planner-group">{g.name}</div>
                  <div className="card meeting-list">
                    {g.items.map((m) => (
                      <MeetingRow key={m.id} m={m} showAssignee={showAssignee} onToggle={toggleDone} onOpen={openEdit} defaultReminder={me.reminder_default_minutes} meId={me.id} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </>
        ) : (
          <div className="week-grid">
            {days.map((d) => {
              const list = meetings.filter((m) => m.meeting_date === d);
              return (
                <div key={d} className={`week-col${d === today ? ' today' : ''}`}>
                  <button className="week-head" onClick={() => { setDate(d); setView('day'); }}>
                    <span>{formatDayShort(d)}</span>
                    <strong>{parseKey(d).getDate()}</strong>
                  </button>
                  <div className="week-items">
                    {list.map((m) => (
                      <button key={m.id} className={`week-item${m.is_done ? ' done' : ''}`} onClick={() => openEdit(m)}>
                        {m.start_time && <span className="wi-time">{formatTime(m.start_time)}</span>}
                        <span className="wi-title">{meetingTitle(m)}</span>
                        {showAssignee && m.assignee?.full_name && <span className="wi-who">{m.assignee.full_name}</span>}
                      </button>
                    ))}
                    <button className="week-add" onClick={() => openNew(d)} aria-label={`Add meeting on ${formatDayLong(d)}`}>＋</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {form && (
        <div className="modal-backdrop" onClick={() => !saving && setForm(null)}>
          <div className="card modal" role="dialog" aria-modal="true" aria-label={form.id ? 'Edit meeting' : 'New meeting'} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>{form.id ? 'Edit meeting' : 'New meeting'}</h2>
              <button className="reminder-x" aria-label="Close" onClick={() => setForm(null)}>✕</button>
            </div>
            <form onSubmit={saveForm}>
              <div className="field-group">
                <label>Title</label>
                <input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Site visit with consultant" />
              </div>
              <div className="form-row-3" style={{ marginBottom: 14 }}>
                <div>
                  <label>Date</label>
                  <input type="date" value={form.meeting_date} onChange={(e) => setForm({ ...form, meeting_date: e.target.value })} />
                </div>
                <div>
                  <label>Start</label>
                  <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                </div>
                <div>
                  <label>End</label>
                  <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                </div>
              </div>
              <div className="form-row-2" style={{ marginBottom: 14 }}>
                <div>
                  <label>Venue</label>
                  <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Office, site, Teams link…" />
                </div>
                <div>
                  <label>Project <span className="optional">(optional)</span></label>
                  <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                    <option value="">No project</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row-2" style={{ marginBottom: 14 }}>
                {isManager && (
                  <div>
                    <label>Assigned to</label>
                    <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
                      <option value={me.id}>Me ({me.full_name || 'you'})</option>
                      {people.filter((p) => p.id !== me.id).map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || 'Unnamed'}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label>Reminder</label>
                  <select value={form.reminder_minutes} onChange={(e) => setForm({ ...form, reminder_minutes: e.target.value })}>
                    <option value="">Default ({reminderLabel(me.reminder_default_minutes ?? 30).toLowerCase()})</option>
                    {REMINDER_OPTIONS.map((r) => <option key={r.value} value={String(r.value)}>{r.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="field-group">
                <label>Notes</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="field-group">
                <label>Course of actions</label>
                <textarea rows={2} value={form.actions} onChange={(e) => setForm({ ...form, actions: e.target.value })} />
              </div>
              {formError && <div className="error-text" style={{ marginBottom: 12 }}>{formError}</div>}
              <div className="modal-actions">
                {form.id && (
                  confirmDelete ? (
                    <button type="button" className="btn btn-danger" disabled={saving} onClick={deleteMeeting}>Yes, delete</button>
                  ) : (
                    <button type="button" className="btn btn-ghost danger-text" onClick={() => setConfirmDelete(true)}>Delete</button>
                  )
                )}
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSettings && (
        <ReminderSettings
          me={me}
          onClose={() => setShowSettings(false)}
          onSaved={(mins) => { setMe({ ...me, reminder_default_minutes: mins }); notifyMeetingsChanged(); }}
          supabase={supabase}
        />
      )}
    </div>
  );
}

function MeetingRow({ m, showDate, showAssignee, onToggle, onOpen, defaultReminder, meId }) {
  // other people's default reminder isn't known here, so only show it for my own meetings
  const rem = m.reminder_minutes ?? (m.assigned_to === meId ? defaultReminder : null);
  return (
    <div className={`meeting-row${m.is_done ? ' done' : ''}`}>
      <button
        className={`check${m.is_done ? ' on' : ''}`}
        aria-label={m.is_done ? 'Mark as not done' : 'Mark as done'}
        aria-pressed={m.is_done}
        onClick={() => onToggle(m)}
      >
        {m.is_done ? '✓' : ''}
      </button>
      <button className="mr-main" onClick={() => onOpen(m)}>
        <span className="mr-time mono">
          {m.start_time ? formatTime(m.start_time) : 'Anytime'}
          {m.end_time ? <span className="mr-end">{formatTime(m.end_time)}</span> : null}
        </span>
        <span className="mr-text">
          <span className="mr-title">{meetingTitle(m)}</span>
          <span className="mr-meta">
            {showDate && <span>{formatDayLong(m.meeting_date)}</span>}
            {m.venue && <span>📍 {m.venue}</span>}
            {m.project?.name && <span>📁 {m.project.name}</span>}
            {m.start_time && rem != null && rem >= 0 && !m.is_done && <span>🔔 {reminderLabel(rem).replace(' before', '')}</span>}
          </span>
        </span>
        {showAssignee && m.assignee?.full_name && (
          <span className="avatar mr-avatar" title={m.assignee.full_name}>{initials(m.assignee.full_name)}</span>
        )}
      </button>
    </div>
  );
}

function ReminderSettings({ me, onClose, onSaved, supabase }) {
  const [mins, setMins] = useState(String(me.reminder_default_minutes ?? 30));
  const [popup, setPopup] = useState(true);
  const [sound, setSound] = useState(true);
  const [perm, setPerm] = useState('default');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPopup(getPref('alarm-popup', true));
    setSound(getPref('alarm-sound', true));
    setPerm(typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported');
  }, []);

  async function save() {
    setErr(''); setMsg('');
    setSaving(true);
    setPref('alarm-popup', popup);
    setPref('alarm-sound', sound);
    const value = Number(mins);
    const { data, error } = await supabase
      .from('profiles').update({ reminder_default_minutes: value }).eq('id', me.id).select('id');
    setSaving(false);
    if (error) { setErr(friendlyDbError(error.message)); return; }
    if (!data || data.length === 0) { setErr('Could not save your default. Please ask your admin to run the planner database update.'); return; }
    onSaved(value);
    setMsg('Saved.');
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return;
    const p = await Notification.requestPermission();
    setPerm(p);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Reminder settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Reminder settings</h2>
          <button className="reminder-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <div className="field-group">
          <label>Default reminder for my meetings</label>
          <select value={mins} onChange={(e) => setMins(e.target.value)}>
            {REMINDER_OPTIONS.map((r) => <option key={r.value} value={String(r.value)}>{r.label}</option>)}
          </select>
          <div className="hint">Each meeting can also have its own reminder time.</div>
        </div>

        <div className="eyebrow" style={{ margin: '18px 0 10px' }}>On this device</div>
        <label className="toggle-row">
          <input type="checkbox" checked={popup} onChange={(e) => setPopup(e.target.checked)} />
          <span>Pop-up alarm before meetings</span>
        </label>
        <label className="toggle-row">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />
          <span>Play a sound and vibrate</span>
        </label>

        <div className="notif-box">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Phone &amp; computer notifications</div>
          {perm === 'granted' && <div className="hint">✅ Notifications are on for this device.</div>}
          {perm === 'denied' && <div className="hint">Notifications are blocked for ACE in this browser. Allow them in the browser&apos;s site settings, then reload.</div>}
          {perm === 'unsupported' && <div className="hint">This browser can&apos;t show notifications. On iPhone, add ACE to your Home Screen first (Share → Add to Home Screen) and open it from there.</div>}
          {perm === 'default' && (
            <>
              <div className="hint" style={{ marginBottom: 8 }}>Show reminders as a system notification even when ACE is in the background.</div>
              <button type="button" className="btn btn-ghost" onClick={enableNotifications}>Turn on notifications</button>
            </>
          )}
          <div className="hint" style={{ marginTop: 8 }}>For now, reminders work while ACE is open in a tab or on your home screen. Alerts when the app is fully closed are coming next.</div>
        </div>

        {err && <div className="error-text" style={{ marginBottom: 10 }}>{err}</div>}
        {msg && <div className="ok-text">{msg}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={() => window.dispatchEvent(new Event('ace-test-alarm'))}>Test alarm</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
