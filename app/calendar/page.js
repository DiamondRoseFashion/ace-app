'use client';

// Calendar: a normal month calendar (weeks start on Sunday) that
// shows, on each day:
//  • 📅 meetings (from Meetings)
//  • ✅ to-dos on their due date and 🔔 to-do reminders (people with
//    To-Do access; repeating reminders show on every day they ring)
//  • 🇦🇪 UAE public holidays
// Tap a day to see everything on it or add a meeting on that day.
// Management can pick a person (or everyone) to see their calendar.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import {
  MANAGEMENT_ROLES, toKey, todayKey, parseKey, addDays, formatTime, formatDayLong,
  meetingTitle, projectLabel, statusOf, statusLabel, isOverdue, friendlyDbError,
} from '@/lib/planner';
import { ruleOf, stepRule } from '@/lib/repeatRule';
import { holidayOn } from '@/lib/uaeHolidays';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MEETING_SELECT = '*, project:projects(id, name), assignee:profiles!assigned_to(id, full_name)';
const MAX_IN_CELL = 3; // more than this shows "+N more"

const firstOfMonth = (key) => `${key.slice(0, 7)}-01`;
function shiftMonth(key, n) {
  const d = parseKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth() + n, 1));
}
const monthTitle = (key) => parseKey(key).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// every day shown in the grid: from the Sunday on/before the 1st to the Saturday on/after the last day
function gridDays(month) {
  const first = parseKey(month);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const start = addDays(month, -first.getDay());
  const count = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

const clock = (d) => { const h = d.getHours(); return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// the days (inside from..to) a to-do reminder rings on; repeating ones step forward by their rule
function reminderDays(t, from, to) {
  if (!t.remind_at) return [];
  const rule = ruleOf(t);
  const end = rule && t.remind_until && t.remind_until < to ? t.remind_until : to;
  const off = -new Date().getTimezoneOffset();
  const out = [];
  let ms = new Date(t.remind_at).getTime();
  for (let i = 0; i < 400 && !Number.isNaN(ms); i++) {
    const d = new Date(ms);
    const key = toKey(d);
    if (key > end) break;
    if (key >= from) out.push({ key, at: d });
    if (!rule) break;
    ms = stepRule(ms, rule, off);
  }
  return out;
}

function meetingClass(m, nowMs) {
  if (isOverdue(m, nowMs)) return 'overdue';
  return statusOf(m); // pending | completed | postponed | cancelled
}

export default function CalendarPage() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const today = todayKey();
  const [me, setMe] = useState(null); // profile
  const [people, setPeople] = useState([]);
  const [who, setWho] = useState('mine'); // 'mine' | 'all' | <profile id> (management)
  const [month, setMonth] = useState(firstOfMonth(today));
  const [selected, setSelected] = useState(today);
  const [meetings, setMeetings] = useState([]);
  const [todos, setTodos] = useState([]);
  const [todoOn, setTodoOn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const panelRef = useRef(null);

  const isManager = MANAGEMENT_ROLES.includes(me?.role);
  const effectiveWho = isManager ? who : 'mine';
  const personId = effectiveWho === 'mine' ? me?.id : effectiveWho === 'all' ? null : effectiveWho;
  const days = useMemo(() => gridDays(month), [month]);
  const from = days[0];
  const to = days[days.length - 1];

  useEffect(() => {
    // back from Meetings after saving: /calendar?d=<YYYY-MM-DD> opens that day
    const d = new URLSearchParams(window.location.search).get('d') || '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { setSelected(d); setMonth(firstOfMonth(d)); window.history.replaceState(null, '', '/calendar'); }
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: prof } = await supabase.from('profiles').select('id, full_name, role').eq('id', user.id).single();
      const profile = prof || { id: user.id, role: 'employee', full_name: user.email };
      const [{ data: ok }, { data: ppl }] = await Promise.all([
        supabase.rpc('has_todo_access'),
        MANAGEMENT_ROLES.includes(profile.role)
          ? supabase.from('profiles').select('id, full_name').order('full_name')
          : Promise.resolve({ data: [] }),
      ]);
      setTodoOn(!!ok);
      setPeople(ppl || []);
      setMe(profile);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!me) return;
    setError('');
    let q = supabase.from('meetings').select(MEETING_SELECT).gte('meeting_date', from).lte('meeting_date', to);
    if (personId) q = q.eq('assigned_to', personId);
    const [mt, td] = await Promise.all([
      q,
      todoOn ? supabase.from('todos').select('*').is('done_at', null) : Promise.resolve({ data: [] }),
    ]);
    if (mt.error) setError(friendlyDbError(mt.error.message));
    setMeetings(mt.data || []);
    setTodos(td.error ? [] : (td.data || []).filter((t) => !personId || t.assigned_to === personId));
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, todoOn, from, to, personId]);

  // stay current when meetings change elsewhere or the person comes back to the tab
  useEffect(() => {
    const again = () => load();
    window.addEventListener('ace-meetings-changed', again);
    window.addEventListener('focus', again);
    return () => { window.removeEventListener('ace-meetings-changed', again); window.removeEventListener('focus', again); };
  });

  const nameOf = (id) => (id === me?.id ? 'Me' : people.find((p) => p.id === id)?.full_name || '');
  const showWho = isManager && effectiveWho === 'all';

  // everything on each day: { [key]: [{ kind, id, time, title, sub, cls, href }] }
  const byDay = useMemo(() => {
    const map = {};
    const put = (key, item) => { (map[key] ||= []).push(item); };
    const nowMs = Date.now();
    for (const m of meetings) {
      const status = meetingClass(m, nowMs);
      put(m.meeting_date, {
        kind: 'meeting', id: m.id,
        time: m.start_time ? m.start_time.slice(0, 5) : '',
        timeLabel: m.start_time ? `${formatTime(m.start_time)}${m.end_time ? ` – ${formatTime(m.end_time)}` : ''}` : 'Anytime',
        title: meetingTitle(m),
        sub: [statusLabel(status), projectLabel(m), m.venue, showWho ? m.assignee?.full_name : ''].filter(Boolean).join(' · '),
        cls: `meeting st-${status}`,
        href: `/planner?date=${m.meeting_date}&open=${m.id}&back=${encodeURIComponent(`/calendar?d=${m.meeting_date}`)}`,
      });
    }
    for (const t of todos) {
      const href = `/todo?open=${t.id}`;
      const person = showWho || t.assigned_to !== me?.id ? nameOf(t.assigned_to) : '';
      const rings = reminderDays(t, from, to);
      for (const r of rings) {
        const due = r.key === t.due_date;
        put(r.key, {
          kind: 'remind', id: `${t.id}-${r.key}`, time: hhmm(r.at), timeLabel: clock(r.at),
          title: t.title,
          sub: [due ? 'Due today' : 'Reminder', ruleOf(t) ? 'repeats' : '', person ? `For ${person}` : ''].filter(Boolean).join(' · '),
          cls: `remind${due ? ' due' : ''}${t.due_date && t.due_date < today ? ' late' : ''}`,
          href,
        });
      }
      // due day (unless a reminder on that day already shows it)
      if (t.due_date && t.due_date >= from && t.due_date <= to && !rings.some((r) => r.key === t.due_date)) {
        put(t.due_date, {
          kind: 'todo', id: t.id, time: '', timeLabel: 'Due',
          title: t.title,
          sub: [t.due_date < today ? 'Overdue' : 'To-do due', t.priority === 'high' ? 'High priority' : '', person ? `For ${person}` : ''].filter(Boolean).join(' · '),
          cls: `todo p-${t.priority}${t.due_date < today ? ' late' : ''}`,
          href,
        });
      }
    }
    // no-time items first (like all-day events), then by time
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.time === b.time ? a.title.localeCompare(b.title) : !a.time ? -1 : !b.time ? 1 : a.time < b.time ? -1 : 1));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, todos, from, to, showWho, me, people, today]);

  function pickDay(key) {
    setSelected(key);
    if (key.slice(0, 7) !== month.slice(0, 7)) setMonth(firstOfMonth(key));
    // on phones the day list is under the calendar: bring it into view
    if (window.matchMedia('(max-width: 1100px)').matches) {
      setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }

  function goToday() { setMonth(firstOfMonth(today)); setSelected(today); }

  const newMeetingHref = (key) => `/planner?new=1&date=${key}${personId && personId !== me?.id ? `&for=${personId}` : ''}&back=${encodeURIComponent(`/calendar?d=${key}`)}`;

  const selItems = byDay[selected] || [];
  const selHoliday = holidayOn(selected);
  const whoLabel = effectiveWho === 'mine' ? 'My calendar' : effectiveWho === 'all' ? 'Everyone' : `${nameOf(effectiveWho) || 'Someone'}'s calendar`;

  return (
    <div className="shell">
      <Sidebar active="calendar" />
      <div className="main calendar">
        <div className="page-header">
          <div>
            <div className="eyebrow">Calendar · {whoLabel}</div>
            <h1 style={{ fontSize: 30, marginTop: 4 }}>{monthTitle(month)}</h1>
          </div>
          <div className="header-actions cal-actions">
            {isManager && (
              <select className="cal-who" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Whose calendar">
                <option value="mine">My calendar</option>
                <option value="all">Everyone</option>
                {people.filter((p) => p.id !== me.id).map((p) => (
                  <option key={p.id} value={p.id}>{p.full_name || 'Unnamed'}</option>
                ))}
              </select>
            )}
            <div className="cal-nav">
              <button type="button" className="nav-arrow" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
              <button type="button" className="btn btn-ghost" onClick={goToday}>Today</button>
              <button type="button" className="nav-arrow" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
            </div>
            <Link className="btn btn-primary" href={newMeetingHref(selected)}>+ New meeting</Link>
          </div>
        </div>

        {error && <div className="notice err">{error}</div>}

        <div className="cal-layout">
          <div className="card cal-card">
            <div className="cal-legend">
              <span><i className="lg lg-meeting" />Meeting</span>
              {todoOn && <span><i className="lg lg-todo" />To-do due</span>}
              {todoOn && <span><i className="lg lg-remind" />Reminder</span>}
              <span><i className="lg lg-holiday" />UAE holiday</span>
              {loading && <span className="cal-loading">Loading…</span>}
            </div>
            <div className="cal-grid" role="grid" aria-label={monthTitle(month)}>
              {WEEK_DAYS.map((w, i) => (
                <div key={w} role="columnheader" className={`cal-dow${i === 0 || i === 6 ? ' wknd' : ''}`}>{w}</div>
              ))}
              {days.map((key) => {
                const d = parseKey(key);
                const items = byDay[key] || [];
                const hol = holidayOn(key);
                const cls = [
                  'cal-day',
                  key.slice(0, 7) !== month.slice(0, 7) && 'out',
                  key === today && 'today',
                  key === selected && 'sel',
                  (d.getDay() === 0 || d.getDay() === 6) && 'wknd',
                  hol && 'hol',
                ].filter(Boolean).join(' ');
                return (
                  <div
                    key={key}
                    role="gridcell"
                    tabIndex={0}
                    className={cls}
                    aria-selected={key === selected}
                    aria-label={`${formatDayLong(key)}${hol ? `, ${hol.name}` : ''}${items.length ? `, ${items.length} item${items.length > 1 ? 's' : ''}` : ''}`}
                    onClick={() => pickDay(key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickDay(key); } }}
                  >
                    <div className="cal-num">{d.getDate()}</div>
                    {hol && <div className="cal-hol" title={hol.moon ? `${hol.name} (expected)` : hol.name}>{hol.name}</div>}
                    <div className="cal-evs">
                      {items.slice(0, MAX_IN_CELL).map((it) => (
                        <Link key={it.id} href={it.href} className={`cal-ev ${it.cls}`} title={`${it.timeLabel} · ${it.title}`} onClick={(e) => e.stopPropagation()}>
                          {it.time && <span className="cal-ev-time">{it.timeLabel.split(' – ')[0].replace(':00 ', ' ')}</span>}
                          {it.title}
                        </Link>
                      ))}
                      {items.length > MAX_IN_CELL && <div className="cal-more">+{items.length - MAX_IN_CELL} more</div>}
                    </div>
                    {items.length > 0 && (
                      <div className="cal-dots" aria-hidden="true">
                        {items.slice(0, 4).map((it) => <i key={it.id} className={`cal-dot ${it.kind}`} />)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card cal-panel" ref={panelRef}>
            <div className="cal-panel-head">
              <div>
                <div className="eyebrow">{selected === today ? 'Today' : 'Selected day'}</div>
                <h2>{formatDayLong(selected)}</h2>
              </div>
            </div>
            {selHoliday && (
              <div className="cal-panel-hol">🇦🇪 {selHoliday.name}{selHoliday.moon ? ' (expected, depends on moon sighting)' : ''}</div>
            )}
            {selItems.length === 0 ? (
              <div className="cal-empty">Nothing on this day.</div>
            ) : (
              <ul className="cal-list">
                {selItems.map((it) => (
                  <li key={it.id}>
                    <Link href={it.href} className={`cal-row ${it.cls}`}>
                      <span className="cal-row-icon" aria-hidden="true">{it.kind === 'meeting' ? '📅' : it.kind === 'remind' ? '🔔' : '✅'}</span>
                      <span className="cal-row-time">{it.timeLabel}</span>
                      <span className="cal-row-text">
                        <strong>{it.title}</strong>
                        {it.sub && <span>{it.sub}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link className="btn btn-primary cal-add" href={newMeetingHref(selected)}>+ Add meeting on this day</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
