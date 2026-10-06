'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabaseClient';
import Sidebar from '@/components/Sidebar';
import {
  MANAGEMENT_ROLES, REMINDER_OPTIONS, reminderLabel, DEFAULT_REMINDER, ANYTIME_REMINDER_HOUR,
  todayKey, addDays, weekDays, parseKey, formatTime, formatDayLong, formatDayShort,
  meetingTitle, initials, getPref, setPref, notifyMeetingsChanged, friendlyDbError,
  STATUSES, statusOf, statusLabel, isOverdue, matchesStatus, projectLabel,
} from '@/lib/planner';
import { enablePush, disablePush, pushStatus } from '@/lib/pushClient';
import { buildCalendar } from '@/lib/ics';
import { downloadXlsx } from '@/lib/xlsxExport';

const SELECT = '*, project:projects(id, name), assignee:profiles!assigned_to(id, full_name)';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'next30', label: 'Next 30 days' },
  { value: 'custom', label: 'Custom dates…' },
];

const GROUPS = [
  { value: 'employee', label: 'Employee' },
  { value: 'date', label: 'Date' },
  { value: 'status', label: 'Status' },
  { value: 'none', label: 'No grouping' },
];

const STATUS_GROUP_ORDER = ['overdue', 'pending', 'completed', 'postponed', 'cancelled'];

function emptyForm(date, assignedTo) {
  return {
    id: null, title: '', meeting_date: date, start_time: '', end_time: '',
    venue: '', project_id: '', projectText: '', projectTouched: false, assigned_to: assignedTo || '', reminder_minutes: '',
    notes: '', actions: '', status: 'pending', originalStatus: 'pending',
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
    projectText: projectLabel(m),
    projectTouched: false,
    assigned_to: m.assigned_to || '',
    reminder_minutes: m.reminder_minutes == null ? '' : String(m.reminder_minutes),
    notes: m.notes || '',
    actions: m.actions || '',
    status: statusOf(m),
    originalStatus: statusOf(m),
  };
}

function partOfDay(m) {
  if (!m.start_time) return 'Anytime';
  const h = Number(m.start_time.slice(0, 2));
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

function sortMeetings(list, newestFirst = false) {
  const sorted = [...list].sort((a, b) => {
    if (a.meeting_date !== b.meeting_date) return a.meeting_date < b.meeting_date ? -1 : 1;
    if (!a.start_time && b.start_time) return 1;
    if (a.start_time && !b.start_time) return -1;
    return (a.start_time || '') < (b.start_time || '') ? -1 : 1;
  });
  return newestFirst ? sorted.reverse() : sorted;
}

function monthBounds(key) {
  const d = parseKey(key);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const k = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return [k(first), k(last)];
}

function rangeDates(range, today, customFrom, customTo) {
  switch (range) {
    case 'today': return [today, today];
    case 'week': { const w = weekDays(today); return [w[0], w[6]]; }
    case 'month': return monthBounds(today);
    case 'last30': return [addDays(today, -29), today];
    case 'next30': return [today, addDays(today, 29)];
    case 'custom': {
      const from = customFrom || today;
      const to = customTo && customTo >= from ? customTo : from;
      return [from, to];
    }
    default: return [today, today];
  }
}

function shortDate(key) {
  return parseKey(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function downloadMeetingsXlsx(rows, filename) {
  const now = Date.now();
  const data = rows.map((m) => ({
    date: m.meeting_date,
    start: m.start_time ? m.start_time.slice(0, 5) : '',
    end: m.end_time ? m.end_time.slice(0, 5) : '',
    title: meetingTitle(m),
    employee: m.assignee?.full_name || '',
    status: isOverdue(m, now) ? 'Overdue' : statusLabel(statusOf(m)),
    project: projectLabel(m),
    venue: m.venue || '',
    notes: m.notes || '',
    actions: m.actions || '',
  }));
  return downloadXlsx(data, [
    { key: 'date', header: 'Date' }, { key: 'start', header: 'Start' }, { key: 'end', header: 'End' },
    { key: 'title', header: 'Title' }, { key: 'employee', header: 'Employee' }, { key: 'status', header: 'Status' },
    { key: 'project', header: 'Project' }, { key: 'venue', header: 'Venue' }, { key: 'notes', header: 'Notes' },
    { key: 'actions', header: 'Course of actions' },
  ], filename, { sheetName: 'Meetings', textCols: ['start', 'end'] });
}

export default function PlannerPage() {
  const router = useRouter();
  const supabaseRef = useRef(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const [me, setMe] = useState(null); // { id, role, full_name, reminder_default_minutes }
  const [people, setPeople] = useState([]);
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState('day'); // day | week | list (list: management only)
  const [date, setDate] = useState(todayKey());
  const [meetings, setMeetings] = useState([]);
  const [carryOver, setCarryOver] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [nowMs, setNowMs] = useState(Date.now());

  // management filters
  const [who, setWho] = useState('mine'); // 'mine' | 'all' | <profile id>
  const [statusFilter, setStatusFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all'); // 'all' | 'none' | <project id>
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [groupBy, setGroupBy] = useState('employee');
  const [newestFirst, setNewestFirst] = useState(false);

  const [quickTitle, setQuickTitle] = useState('');
  const [quickTime, setQuickTime] = useState('');
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOutlook, setShowOutlook] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const isManager = MANAGEMENT_ROLES.includes(me?.role);
  const today = todayKey();
  const days = useMemo(() => weekDays(date), [date]);
  const [listFrom, listTo] = rangeDates(range, today, customFrom, customTo);
  // day & week load the whole week so the day strip can show which days have meetings
  const rangeFrom = view === 'list' ? listFrom : days[0];
  const rangeTo = view === 'list' ? listTo : days[6];

  // Employees only ever see their own meetings
  const effectiveWho = isManager ? who : 'mine';
  const filterId = effectiveWho === 'mine' ? me?.id : effectiveWho === 'all' ? null : effectiveWho;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      const { data: prof } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
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
    const tick = setInterval(() => setNowMs(Date.now()), 60 * 1000); // keeps "Overdue" current
    return () => clearInterval(tick);
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
    if (view === 'day' && date === today && effectiveWho === 'mine') {
      const { data: past } = await supabase.from('meetings').select(SELECT)
        .eq('assigned_to', me.id).eq('is_done', false).not('start_time', 'is', null)
        .gte('meeting_date', addDays(today, -7)).lt('meeting_date', today);
      setCarryOver(sortMeetings((past || []).filter((m) => statusOf(m) === 'pending')));
    } else {
      setCarryOver([]);
    }
    setLoading(false);
  }

  useEffect(() => { if (view !== 'list') exitSelect(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [view]);

  useEffect(() => {
    loadMeetings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, view, rangeFrom, rangeTo, date === today, effectiveWho]);

  useEffect(() => {
    const onChange = () => loadMeetings();
    window.addEventListener('ace-meetings-changed', onChange);
    return () => window.removeEventListener('ace-meetings-changed', onChange);
  });

  // ---------- actions ----------
  function patchLocal(id, fields) {
    const patch = (list) => list.map((x) => (x.id === id ? { ...x, ...fields } : x));
    setMeetings(patch);
    setCarryOver(patch);
  }

  async function toggleDone(m) {
    const next = statusOf(m) !== 'completed';
    patchLocal(m.id, { is_done: next, status: next ? 'completed' : 'pending' });
    // the tick-box updates is_done; the database keeps status in step
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
    setForm(emptyForm(forDate || (view === 'list' ? today : date), assignee));
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
      reminder_minutes: form.reminder_minutes === '' ? null : Number(form.reminder_minutes),
      notes: form.notes.trim() || null,
      actions: form.actions.trim() || null,
    };
    if (form.status !== form.originalStatus) payload.status = form.status;
    // Project: only send it when it was changed (or for a new meeting), so
    // editing a meeting linked to a project you can't see never unlinks it.
    if (!form.id || form.projectTouched) {
      const text = form.projectText.trim();
      const match = text && projects.find((p) => p.name.trim().toLowerCase() === text.toLowerCase());
      if (match) { payload.project_id = match.id; payload.project_name = null; }
      else if (text) { payload.project_id = null; payload.project_name = text; }
      else { payload.project_id = null; payload.project_name = null; }
    }
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

  // employees can't delete meetings (they can mark them Cancelled instead)
  function canDeleteMeeting() {
    return isManager;
  }

  async function deleteOne(m) {
    setNotice('');
    const { data, error } = await supabase.from('meetings').delete().eq('id', m.id).select('id');
    if (error) { setPageError(friendlyDbError(error.message)); return; }
    if (!data || data.length === 0) { setPageError("You don't have permission to delete this meeting."); return; }
    setMeetings((list) => list.filter((x) => x.id !== m.id));
    setCarryOver((list) => list.filter((x) => x.id !== m.id));
    setNotice(`Deleted "${meetingTitle(m)}".`);
    notifyMeetingsChanged();
  }

  function toggleSelect(id) {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function exitSelect() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setBulkConfirm(false);
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkBusy(true);
    const { data, error } = await supabase.from('meetings').delete().in('id', ids).select('id');
    setBulkBusy(false);
    if (error) { setPageError(friendlyDbError(error.message)); return; }
    const n = (data || []).length;
    setNotice(`${n} meeting${n === 1 ? '' : 's'} deleted.`);
    exitSelect();
    notifyMeetingsChanged();
    loadMeetings();
  }

  function clearFilters() {
    setStatusFilter('all');
    setProjectFilter('all');
    setSearch('');
  }

  // ---------- derived ----------
  const q = search.trim().toLowerCase();
  const passesOther = (m) => {
    if (!isManager) return true;
    if (projectFilter === 'none' && projectLabel(m)) return false;
    if (projectFilter.startsWith('id:') && m.project_id !== projectFilter.slice(3)) return false;
    if (projectFilter.startsWith('name:') && (m.project_id || (m.project_name || '').trim().toLowerCase() !== projectFilter.slice(5))) return false;
    if (q) {
      const hay = [meetingTitle(m), m.venue, m.notes, m.actions, projectLabel(m), m.assignee?.full_name]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const passes = (m) => passesOther(m) && (!isManager || matchesStatus(m, statusFilter, nowMs));

  const visible = meetings.filter(passes);
  const visibleCarry = carryOver.filter(passes);
  const filtersActive = isManager && (statusFilter !== 'all' || projectFilter !== 'all' || q);

  const dayMeetings = visible.filter((m) => m.meeting_date === date);
  const dayActive = dayMeetings.filter((m) => ['pending', 'completed'].includes(statusOf(m)));
  const doneCount = dayActive.filter((m) => statusOf(m) === 'completed').length;
  const groups = ['Morning', 'Afternoon', 'Evening', 'Anytime']
    .map((name) => ({ name, items: dayMeetings.filter((m) => partOfDay(m) === name) }))
    .filter((g) => g.items.length > 0);
  const countByDay = useMemo(() => {
    const map = {};
    visible.forEach((m) => { map[m.meeting_date] = (map[m.meeting_date] || 0) + 1; });
    return map;
  }, [visible]);
  const showAssignee = isManager && effectiveWho !== 'mine';

  // project names typed on meetings (not in the Projects list), for the filter
  const typedProjects = useMemo(() => {
    const map = new Map();
    meetings.forEach((m) => {
      if (m.project_id || !m.project_name?.trim()) return;
      const key = m.project_name.trim().toLowerCase();
      if (!map.has(key)) map.set(key, { key, label: m.project_name.trim() });
    });
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [meetings]);

  // summary (status filter not applied, so the numbers always add up)
  const base = meetings.filter(passesOther);
  const stats = {
    total: base.length,
    completed: base.filter((m) => statusOf(m) === 'completed').length,
    pending: base.filter((m) => statusOf(m) === 'pending').length,
    overdue: base.filter((m) => isOverdue(m, nowMs)).length,
    postponed: base.filter((m) => statusOf(m) === 'postponed').length,
    cancelled: base.filter((m) => statusOf(m) === 'cancelled').length,
  };
  const countable = stats.completed + stats.pending;
  const completionRate = countable ? Math.round((stats.completed / countable) * 100) : null;

  // list view grouping
  const listItems = sortMeetings(visible, newestFirst);
  let listGroups = [];
  if (view === 'list') {
    if (groupBy === 'employee') {
      const map = new Map();
      listItems.forEach((m) => {
        const name = m.assignee?.full_name || 'Unassigned';
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(m);
      });
      listGroups = [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, items]) => ({ key: name, title: name, avatar: initials(name), items }));
    } else if (groupBy === 'date') {
      const map = new Map();
      listItems.forEach((m) => {
        if (!map.has(m.meeting_date)) map.set(m.meeting_date, []);
        map.get(m.meeting_date).push(m);
      });
      listGroups = [...map.entries()].map(([d, items]) => ({
        key: d, title: `${formatDayLong(d)}${d === today ? ' · Today' : ''}`, items,
      }));
    } else if (groupBy === 'status') {
      listGroups = STATUS_GROUP_ORDER.map((st) => ({
        key: st,
        title: st === 'pending' ? 'Upcoming' : statusLabel(st),
        pill: st,
        items: listItems.filter((m) => (st === 'overdue' ? isOverdue(m, nowMs)
          : st === 'pending' ? statusOf(m) === 'pending' && !isOverdue(m, nowMs)
            : statusOf(m) === st)),
      })).filter((g) => g.items.length > 0);
    } else {
      listGroups = listItems.length ? [{ key: 'all', title: null, items: listItems }] : [];
    }
  }

  const whoLabel = effectiveWho === 'mine' ? 'My meetings'
    : effectiveWho === 'all' ? 'All employees'
      : (people.find((p) => p.id === effectiveWho)?.full_name || 'Employee');

  const heading = view === 'list'
    ? 'Meetings overview'
    : view === 'week'
      ? `${parseKey(days[0]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${parseKey(days[6]).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : date === today ? (effectiveWho === 'mine' ? 'My Day' : 'Today') : formatDayLong(date);

  if (!me) {
    return <div className="shell"><Sidebar active="planner" /><div className="main">Loading…</div></div>;
  }

  const rowProps = {
    onToggle: toggleDone, onOpen: openEdit, defaultReminder: me.reminder_default_minutes, meId: me.id, nowMs,
    onDelete: deleteOne, canDelete: canDeleteMeeting,
    selectMode, selectedIds, onSelect: toggleSelect,
  };

  return (
    <div className="shell">
      <Sidebar active="planner" />
      <div className="main planner">
        <div className="page-header">
          <div>
            <div className="eyebrow">Meetings Planner</div>
            <h1 style={{ fontSize: 30, marginTop: 4 }}>{heading}</h1>
            {view === 'day' && date === today && <div className="planner-sub">{formatDayLong(today)}</div>}
            {view === 'list' && <div className="planner-sub">{whoLabel} · {shortDate(listFrom)}{listTo !== listFrom ? ` – ${shortDate(listTo)}` : ''}</div>}
          </div>
          <div className="header-actions">
            <div className="seg" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === 'day'} className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>Day</button>
              <button role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Week</button>
              {isManager && (
                <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
              )}
            </div>
            <button className="btn btn-ghost" onClick={() => setShowOutlook(true)}>📆 Outlook</button>
            <button className="btn btn-ghost" onClick={() => setShowSettings(true)}>⚙️ Reminders</button>
            <button className="btn btn-primary" onClick={() => openNew()}>+ New meeting</button>
          </div>
        </div>

        {/* Management filters */}
        {isManager && (
          <div className="filter-bar">
            <div className="fb-row">
              <label className="fb-field">
                <span>Person</span>
                <select value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="mine">My meetings</option>
                  <option value="all">All employees</option>
                  {people.filter((p) => p.id !== me.id).map((p) => (
                    <option key={p.id} value={p.id}>{p.full_name || 'Unnamed'}</option>
                  ))}
                </select>
              </label>
              <label className="fb-field">
                <span>Project</span>
                <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                  <option value="all">All projects</option>
                  <option value="none">No project</option>
                  {projects.map((p) => <option key={p.id} value={`id:${p.id}`}>{p.name}</option>)}
                  {typedProjects.length > 0 && (
                    <optgroup label="Typed on meetings">
                      {typedProjects.map((n) => <option key={n.key} value={`name:${n.key}`}>{n.label}</option>)}
                    </optgroup>
                  )}
                </select>
              </label>
              <label className="fb-field fb-search">
                <span>Search</span>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title, venue, notes…" />
              </label>
            </div>
            <div className="fb-row">
              <div className="status-chips" role="group" aria-label="Status">
                {STATUS_FILTERS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`chip chip-${s.value}${statusFilter === s.value ? ' on' : ''}`}
                    aria-pressed={statusFilter === s.value}
                    onClick={() => setStatusFilter(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {filtersActive && <button type="button" className="fb-clear" onClick={clearFilters}>Clear filters</button>}
            </div>
            {view === 'list' && (
              <div className="fb-row">
                <label className="fb-field">
                  <span>Dates</span>
                  <select value={range} onChange={(e) => setRange(e.target.value)}>
                    {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
                {range === 'custom' && (
                  <>
                    <label className="fb-field"><span>From</span><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
                    <label className="fb-field"><span>To</span><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
                  </>
                )}
                <label className="fb-field">
                  <span>Group by</span>
                  <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </label>
                <label className="fb-field">
                  <span>Order</span>
                  <select value={newestFirst ? 'new' : 'old'} onChange={(e) => setNewestFirst(e.target.value === 'new')}>
                    <option value="old">Oldest first</option>
                    <option value="new">Newest first</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Summary (management) */}
        {isManager && (
          <div className="stat-row">
            <button type="button" className={`stat${statusFilter === 'all' ? ' on' : ''}`} onClick={() => setStatusFilter('all')}>
              <strong>{stats.total}</strong><span>Total</span>
            </button>
            <button type="button" className={`stat st-completed${statusFilter === 'completed' ? ' on' : ''}`} onClick={() => setStatusFilter('completed')}>
              <strong>{stats.completed}</strong><span>Completed</span>
            </button>
            <button type="button" className={`stat st-pending${statusFilter === 'pending' ? ' on' : ''}`} onClick={() => setStatusFilter('pending')}>
              <strong>{stats.pending}</strong><span>Pending</span>
            </button>
            <button type="button" className={`stat st-overdue${statusFilter === 'overdue' ? ' on' : ''}`} onClick={() => setStatusFilter('overdue')}>
              <strong>{stats.overdue}</strong><span>Overdue</span>
            </button>
            <button type="button" className={`stat st-postponed${statusFilter === 'postponed' ? ' on' : ''}`} onClick={() => setStatusFilter('postponed')}>
              <strong>{stats.postponed}</strong><span>Postponed</span>
            </button>
            <button type="button" className={`stat st-cancelled${statusFilter === 'cancelled' ? ' on' : ''}`} onClick={() => setStatusFilter('cancelled')}>
              <strong>{stats.cancelled}</strong><span>Cancelled</span>
            </button>
            <div className="stat stat-rate" title="Completed out of completed + pending">
              <strong>{completionRate == null ? '—' : `${completionRate}%`}</strong><span>Completion</span>
            </div>
          </div>
        )}

        {/* Date navigation (day & week) */}
        {view !== 'list' && (
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
          </div>
        )}

        {pageError && <div className="card planner-error">{pageError}</div>}
        {notice && <div className="notice ok">{notice}</div>}

        {view === 'day' && (
          <>
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

            {dayActive.length > 0 && (
              <div className="progress-row">
                <div className="progress-bar"><div style={{ width: `${(doneCount / dayActive.length) * 100}%` }} /></div>
                <span>{doneCount} of {dayActive.length} done</span>
              </div>
            )}

            {visibleCarry.length > 0 && (
              <>
                <div className="eyebrow planner-group">Still open from earlier</div>
                <div className="card meeting-list">
                  {visibleCarry.map((m) => <MeetingRow key={m.id} m={m} showDate showAssignee={false} {...rowProps} />)}
                </div>
              </>
            )}

            {loading ? (
              <div className="card" style={{ color: 'var(--muted)' }}>Loading…</div>
            ) : dayMeetings.length === 0 ? (
              <div className="card empty-day">
                <div className="empty-icon" aria-hidden="true">🗓️</div>
                <div className="empty-title">{filtersActive ? 'No meetings match these filters' : `Nothing scheduled${date === today ? ' today' : ''}`}</div>
                <div className="empty-sub">{filtersActive ? 'Try another status or clear the filters.' : 'Add a meeting above, or plan ahead in the week view.'}</div>
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.name}>
                  <div className="eyebrow planner-group">{g.name}</div>
                  <div className="card meeting-list">
                    {g.items.map((m) => <MeetingRow key={m.id} m={m} showAssignee={showAssignee} {...rowProps} />)}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {view === 'week' && (
          <div className="week-grid">
            {days.map((d) => {
              const list = visible.filter((m) => m.meeting_date === d);
              return (
                <div key={d} className={`week-col${d === today ? ' today' : ''}`}>
                  <button className="week-head" onClick={() => { setDate(d); setView('day'); }}>
                    <span>{formatDayShort(d)}</span>
                    <strong>{parseKey(d).getDate()}</strong>
                  </button>
                  <div className="week-items">
                    {list.map((m) => {
                      const st = isOverdue(m, nowMs) ? 'overdue' : statusOf(m);
                      return (
                        <button key={m.id} className={`week-item wi-${st}${st === 'completed' ? ' done' : ''}`} onClick={() => openEdit(m)}>
                          {m.start_time && <span className="wi-time">{formatTime(m.start_time)}</span>}
                          <span className="wi-title">{meetingTitle(m)}</span>
                          {st !== 'pending' && st !== 'completed' && <span className={`pill-status ps-${st}`}>{statusLabel(st)}</span>}
                          {showAssignee && m.assignee?.full_name && <span className="wi-who">{m.assignee.full_name}</span>}
                        </button>
                      );
                    })}
                    <button className="week-add" onClick={() => openNew(d)} aria-label={`Add meeting on ${formatDayLong(d)}`}>＋</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === 'list' && isManager && (
          <>
            <div className="list-toolbar">
              <span>{listItems.length} meeting{listItems.length === 1 ? '' : 's'}</span>
              <span style={{ flex: 1 }} />
              {!selectMode && listItems.length > 0 && (
                <button type="button" className="btn btn-ghost" onClick={() => { setSelectMode(true); setNotice(''); }}>Select</button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                disabled={listItems.length === 0}
                onClick={() => downloadMeetingsXlsx(listItems, `ACE-meetings-${listFrom}-to-${listTo}.xlsx`)}
              >
                ⬇ Download for Excel
              </button>
            </div>
            {selectMode && (
              <div className="select-bar">
                <label className="toggle-row" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={listItems.length > 0 && listItems.every((m) => selectedIds.has(m.id))}
                    onChange={(e) => setSelectedIds(e.target.checked ? new Set(listItems.map((m) => m.id)) : new Set())}
                  />
                  <span>Select all {listItems.length} shown</span>
                </label>
                <span className="sb-count">{selectedIds.size} selected</span>
                <span style={{ flex: 1 }} />
                {bulkConfirm ? (
                  <>
                    <span className="sb-count" style={{ color: 'var(--err)' }}>Delete {selectedIds.size} permanently?</span>
                    <button className="btn btn-ghost" disabled={bulkBusy} onClick={() => setBulkConfirm(false)}>No</button>
                    <button className="btn btn-danger" disabled={bulkBusy} onClick={deleteSelected}>{bulkBusy ? 'Deleting…' : 'Yes, delete'}</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-ghost" onClick={exitSelect}>Cancel</button>
                    <button className="btn btn-danger" disabled={selectedIds.size === 0} onClick={() => setBulkConfirm(true)}>🗑 Delete selected</button>
                  </>
                )}
              </div>
            )}
            {loading ? (
              <div className="card" style={{ color: 'var(--muted)' }}>Loading…</div>
            ) : listGroups.length === 0 ? (
              <div className="card empty-day">
                <div className="empty-icon" aria-hidden="true">🔎</div>
                <div className="empty-title">No meetings found</div>
                <div className="empty-sub">Try a wider date range, another person, or clear the filters.</div>
              </div>
            ) : (
              listGroups.map((g) => {
                const done = g.items.filter((m) => statusOf(m) === 'completed').length;
                const late = g.items.filter((m) => isOverdue(m, nowMs)).length;
                return (
                  <div key={g.key}>
                    {g.title && (
                      <div className="list-group-head">
                        {g.avatar && <span className="avatar">{g.avatar}</span>}
                        {g.pill && <span className={`pill-status ps-${g.pill}`}>{g.title}</span>}
                        {!g.pill && <strong>{g.title}</strong>}
                        <span className="lgh-meta">
                          {g.items.length} meeting{g.items.length === 1 ? '' : 's'}
                          {groupBy !== 'status' && ` · ${done} completed`}
                          {groupBy !== 'status' && late > 0 && <span className="lgh-late"> · {late} overdue</span>}
                        </span>
                      </div>
                    )}
                    <div className="card meeting-list">
                      {g.items.map((m) => (
                        <MeetingRow key={m.id} m={m} showDate showAssignee={groupBy !== 'employee'} {...rowProps} />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </>
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
              {form.id && (
                <div className="field-group">
                  <label>Status</label>
                  <div className="status-picker" role="radiogroup" aria-label="Meeting status">
                    {STATUSES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        role="radio"
                        aria-checked={form.status === s.value}
                        className={`sp sp-${s.value}${form.status === s.value ? ' on' : ''}`}
                        onClick={() => setForm({ ...form, status: s.value })}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {form.status === 'postponed' && (
                    <div className="hint">Reminders are paused. To reschedule, change the date below and it goes back to Pending.</div>
                  )}
                  {form.status === 'cancelled' && <div className="hint">Reminders are switched off for this meeting.</div>}
                </div>
              )}
              <div className="field-group">
                <label>Title</label>
                <input autoFocus={!form.id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Site visit with consultant" />
              </div>
              <div className="form-row-3" style={{ marginBottom: 14 }}>
                <div>
                  <label>Date</label>
                  <input
                    type="date"
                    value={form.meeting_date}
                    onChange={(e) => setForm({
                      ...form,
                      meeting_date: e.target.value,
                      // moving a postponed meeting to a new date reschedules it
                      status: form.status === 'postponed' ? 'pending' : form.status,
                    })}
                  />
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
                  <ProjectPicker
                    value={form.projectText}
                    projects={projects}
                    onChange={(text) => setForm({ ...form, projectText: text, projectTouched: true })}
                  />
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
                    <option value="">Default ({reminderLabel(me.reminder_default_minutes ?? DEFAULT_REMINDER).toLowerCase()})</option>
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
                {form.id && isManager && (
                  confirmDelete ? (
                    <button type="button" className="btn btn-danger" disabled={saving} onClick={deleteMeeting}>Yes, delete</button>
                  ) : (
                    <button type="button" className="btn btn-ghost danger-text" onClick={() => setConfirmDelete(true)}>Delete</button>
                  )
                )}
                {form.id && (
                  <button type="button" className="btn btn-ghost" onClick={() => downloadIcs(meetings.concat(carryOver).find((x) => x.id === form.id))}>📆 Add to Outlook</button>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showOutlook && <OutlookConnect supabase={supabase} onClose={() => setShowOutlook(false)} />}

      {showSettings && (
        <ReminderSettings
          me={me}
          onClose={() => setShowSettings(false)}
          onSaved={(mins, rep) => { setMe({ ...me, reminder_default_minutes: mins, reminder_repeat: rep }); notifyMeetingsChanged(); }}
          supabase={supabase}
        />
      )}
    </div>
  );
}

function downloadIcs(m) {
  if (!m) return;
  const ics = buildCalendar([m], { name: 'ACE Meeting' });
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (m.title || 'meeting').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'meeting';
  a.href = url;
  a.download = `${safe}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function OutlookConnect({ supabase, onClose }) {
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  function toUrl(token) {
    return `${window.location.origin}/api/calendar/${token}.ics`;
  }

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('get_my_calendar_token');
      if (error) {
        setErr(/function|schema cache|does not exist/i.test(error.message)
          ? 'The Outlook connection needs a one-time database update. Please ask your admin to run it in Supabase.'
          : error.message);
        return;
      }
      setLink(toUrl(data));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.getElementById('ace-cal-link');
      el?.select();
      document.execCommand?.('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function reset() {
    setBusy(true);
    const { data, error } = await supabase.rpc('reset_my_calendar_token');
    setBusy(false);
    setConfirmReset(false);
    if (error) { setErr(error.message); return; }
    setLink(toUrl(data));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="Connect to Outlook" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Show my meetings in Outlook</h2>
          <button className="reminder-x" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <p className="hint" style={{ marginTop: 0, fontSize: 13 }}>
          Your ACE meetings appear in your Outlook calendar on computer, phone and web, and stay updated when meetings change.
        </p>

        <label>Your private calendar link</label>
        {err ? (
          <div className="error-text" style={{ marginBottom: 12 }}>{err}</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input id="ace-cal-link" readOnly value={link || 'Loading…'} onFocus={(e) => e.target.select()} className="mono" style={{ fontSize: 12 }} />
            <button type="button" className="btn btn-primary" disabled={!link} onClick={copy} style={{ flexShrink: 0 }}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>
        )}
        <div className="hint" style={{ marginBottom: 16 }}>Keep this link private: anyone who has it can see your meetings.</div>

        <div className="notif-box" style={{ marginTop: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Add it to Outlook (once)</div>
          <ol className="steps">
            <li>Open <strong>outlook.office.com</strong> (or the new Outlook app) and go to <strong>Calendar</strong>.</li>
            <li>Click <strong>Add calendar</strong> → <strong>Subscribe from web</strong>.</li>
            <li>Paste the link, name it <strong>ACE Meetings</strong>, then click <strong>Import</strong>.</li>
          </ol>
          <div className="hint" style={{ marginTop: 6 }}>
            Classic Outlook on Windows: <strong>Calendar → Add Calendar → From Internet</strong>, paste, <strong>OK</strong>.
            It then shows on Outlook on your phone too.
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            Outlook checks for changes every few hours. To put one meeting in Outlook right away, open it and tap <strong>📆 Add to Outlook</strong>.
          </div>
        </div>

        <div className="modal-actions">
          {confirmReset ? (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={reset}>Yes, make a new link</button>
          ) : (
            <button type="button" className="btn btn-ghost danger-text" disabled={!link} onClick={() => setConfirmReset(true)}>Reset link</button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
        {confirmReset && <div className="hint">The old link stops working, and you&apos;ll need to add the new one to Outlook again.</div>}
      </div>
    </div>
  );
}

// Type-or-pick project box: suggests matching projects from the list,
// and lets you keep a new name that isn't in the list.
function ProjectPicker({ value, projects, onChange }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const text = value.trim().toLowerCase();
  const matches = projects
    .filter((p) => !text || p.name.toLowerCase().includes(text))
    .slice(0, 8);
  const exact = text && projects.some((p) => p.name.trim().toLowerCase() === text);
  const options = [
    ...matches.map((p) => ({ type: 'project', label: p.name })),
    ...(text && !exact ? [{ type: 'new', label: value.trim() }] : []),
  ];

  useEffect(() => {
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc); };
  }, []);

  function choose(o) {
    onChange(o.label);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && open && active >= 0 && options[active]) { e.preventDefault(); choose(options[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div className="pp" ref={wrapRef}>
      <div className="pp-input">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={projects.length ? 'Pick a project or type a name' : 'Type a project name'}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-label="Project"
          autoComplete="off"
        />
        {value && (
          <button type="button" className="pp-clear" aria-label="Clear project" onClick={() => { onChange(''); setOpen(false); }}>✕</button>
        )}
      </div>
      {open && (options.length > 0 || !value) && (
        <div className="pp-menu" role="listbox">
          {options.map((o, i) => (
            <button
              type="button"
              key={`${o.type}-${o.label}`}
              role="option"
              aria-selected={i === active}
              className={`pp-opt${i === active ? ' active' : ''}${o.type === 'new' ? ' pp-new' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              {o.type === 'new' ? <>＋ Use “{o.label}”<span className="pp-sub">new name, not in Projects</span></> : <>📁 {o.label}</>}
            </button>
          ))}
          {options.length === 0 && <div className="pp-empty">No projects yet. Type a name to use one.</div>}
        </div>
      )}
    </div>
  );
}

function MeetingRow({ m, showDate, showAssignee, onToggle, onOpen, defaultReminder, meId, nowMs, onDelete, canDelete, selectMode, selectedIds, onSelect }) {
  const [askDel, setAskDel] = useState(false);
  const deletable = canDelete ? canDelete(m) : false;
  const status = statusOf(m);
  const overdue = isOverdue(m, nowMs);
  const active = status === 'pending';
  // other people's default reminder isn't known here, so only show it for my own meetings
  const rem = m.reminder_minutes ?? (m.assigned_to === meId ? defaultReminder : null);
  const done = status === 'completed';
  return (
    <div className={`meeting-row mr-${status}${overdue ? ' mr-overdue' : ''}${selectMode && selectedIds?.has(m.id) ? ' mr-selected' : ''}`}>
      {selectMode && (
        <input
          type="checkbox"
          className="row-check"
          checked={selectedIds?.has(m.id) || false}
          onChange={() => onSelect(m.id)}
          aria-label={`Select ${meetingTitle(m)}`}
          style={{ marginRight: 8 }}
        />
      )}
      <button
        className={`check${done ? ' on' : ''}`}
        aria-label={done ? 'Mark as pending' : 'Mark as completed'}
        aria-pressed={done}
        onClick={() => onToggle(m)}
      >
        {done ? '✓' : ''}
      </button>
      <button className="mr-main" onClick={() => onOpen(m)}>
        <span className="mr-time mono">
          {m.start_time ? formatTime(m.start_time) : 'Anytime'}
          {m.end_time ? <span className="mr-end">{formatTime(m.end_time)}</span> : null}
        </span>
        <span className="mr-text">
          <span className="mr-title">
            {meetingTitle(m)}
            {overdue && <span className="pill-status ps-overdue">Overdue</span>}
            {(status === 'cancelled' || status === 'postponed') && <span className={`pill-status ps-${status}`}>{statusLabel(status)}</span>}
          </span>
          <span className="mr-meta">
            {showDate && <span>{formatDayLong(m.meeting_date)}</span>}
            {m.venue && <span>📍 {m.venue}</span>}
            {projectLabel(m) && <span>📁 {projectLabel(m)}</span>}
            {active && !overdue && m.start_time && rem != null && rem >= 0 && <span>🔔 {reminderLabel(rem).replace(' before', '')}</span>}
            {active && !overdue && !m.start_time && m.assigned_to === meId && m.reminder_minutes !== -1 && <span>🔔 {ANYTIME_REMINDER_HOUR}:00 AM</span>}
          </span>
        </span>
        {showAssignee && m.assignee?.full_name && (
          <span className="avatar mr-avatar" title={m.assignee.full_name}>{initials(m.assignee.full_name)}</span>
        )}
      </button>
      {deletable && !selectMode && (
        askDel ? (
          <span className="mr-confirm">
            Delete?
            <button className="btn btn-ghost" onClick={() => setAskDel(false)}>No</button>
            <button className="btn btn-danger" onClick={() => { setAskDel(false); onDelete(m); }}>Yes</button>
          </span>
        ) : (
          <button className="icon-btn danger mr-del" aria-label={`Delete ${meetingTitle(m)}`} title="Delete meeting" onClick={() => setAskDel(true)}>🗑</button>
        )
      )}
    </div>
  );
}

function ReminderSettings({ me, onClose, onSaved, supabase }) {
  const [mins, setMins] = useState(String(me.reminder_default_minutes ?? DEFAULT_REMINDER));
  const [popup, setPopup] = useState(true);
  const [repeat, setRepeat] = useState(me.reminder_repeat !== false);
  const [sound, setSound] = useState(true);
  const [push, setPush] = useState('checking'); // on | off | denied | unsupported | needs-home-screen
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPopup(getPref('alarm-popup', true));
    setSound(getPref('alarm-sound', true));
    pushStatus().then(setPush).catch(() => setPush('unsupported'));
  }, []);

  async function save() {
    setErr(''); setMsg('');
    setSaving(true);
    setPref('alarm-popup', popup);
    setPref('alarm-sound', sound);
    const value = Number(mins);
    const patch = { reminder_default_minutes: value };
    if ('reminder_repeat' in me || repeat === false) patch.reminder_repeat = repeat;
    const { data, error } = await supabase
      .from('profiles').update(patch).eq('id', me.id).select('id');
    setSaving(false);
    if (error) { setErr(friendlyDbError(error.message)); return; }
    if (!data || data.length === 0) { setErr('Could not save your default. Please ask your admin to run the planner database update.'); return; }
    onSaved(value, repeat);
    setMsg('Saved.');
  }

  async function turnOnPush() {
    setPushMsg(''); setPushBusy(true);
    try {
      const r = await enablePush(supabase);
      setPush(r);
      if (r === 'on') setPushMsg('✅ This device will now get meeting reminders, even when ACE is closed.');
    } catch (e) {
      setPushMsg(friendlyDbError(e.message) || 'Could not turn on notifications.');
    }
    setPushBusy(false);
  }

  async function turnOffPush() {
    setPushMsg(''); setPushBusy(true);
    try { await disablePush(supabase); setPush('off'); setPushMsg('Notifications turned off for this device.'); } catch { /* ignore */ }
    setPushBusy(false);
  }

  async function sendTest() {
    setPushMsg(''); setPushBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/push-test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setPushMsg(body.error || 'Could not send a test.');
      else setPushMsg(`Test sent to ${body.delivered} of your device${body.devices === 1 ? '' : 's'}. It should appear within a few seconds.`);
    } catch {
      setPushMsg('Could not send a test.');
    }
    setPushBusy(false);
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
          <div className="hint">Used for any meeting where you didn&apos;t choose a reminder. Each meeting can also have its own time. Meetings without a start time remind you at {ANYTIME_REMINDER_HOUR}:00 AM that day. The alarm keeps ringing until you stop it.</div>
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
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Reminders when ACE is closed</div>
          {push === 'checking' && <div className="hint">Checking this device…</div>}
          {push === 'on' && (
            <>
              <div className="hint">✅ On for this device. Reminders arrive as a phone/computer notification even when ACE is closed.</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost" disabled={pushBusy} onClick={sendTest}>Send test notification</button>
                <button type="button" className="btn btn-ghost danger-text" disabled={pushBusy} onClick={turnOffPush}>Turn off on this device</button>
              </div>
            </>
          )}
          {push === 'off' && (
            <>
              <div className="hint" style={{ marginBottom: 8 }}>Get meeting reminders on this phone or computer even when ACE is closed.</div>
              <button type="button" className="btn btn-primary" disabled={pushBusy} onClick={turnOnPush}>{pushBusy ? 'Turning on…' : 'Turn on notifications'}</button>
            </>
          )}
          {push === 'denied' && <div className="hint">Notifications are blocked for ACE in this browser. Tap the icon to the left of the web address → Site settings → Notifications → Allow, then reload ACE.</div>}
          {push === 'needs-home-screen' && <div className="hint">On iPhone: tap the Share button <strong>⬆︎</strong> in Safari → <strong>Add to Home Screen</strong>. Then open ACE from its new icon and come back here to turn on notifications.</div>}
          {push === 'unsupported' && <div className="hint">This browser can&apos;t receive background notifications. Please use Chrome, Edge or Safari (on iPhone, from the Home Screen icon).</div>}
          {pushMsg && <div className="hint" style={{ marginTop: 8, color: 'var(--ink)' }}>{pushMsg}</div>}
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
