// Shared helpers for the meetings planner and reminder pop-up.
// Dates are handled as local "YYYY-MM-DD" strings so a meeting on
// the 25th stays on the 25th regardless of time zone.

export const MANAGEMENT_ROLES = ['owner', 'admin', 'manager'];

// If nobody picked a reminder, remind this many minutes before the start
export const DEFAULT_REMINDER = 60;
// Meetings with no start time ("Anytime") ring at this hour on the day
export const ANYTIME_REMINDER_HOUR = 9;

export const REMINDER_OPTIONS = [
  { value: -1, label: 'No reminder' },
  { value: 0, label: 'At start time' },
  { value: 5, label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
];

export function reminderLabel(mins) {
  const o = REMINDER_OPTIONS.find((r) => r.value === mins);
  return o ? o.label : `${mins} minutes before`;
}

export function toKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function todayKey() {
  return toKey(new Date());
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

// Monday-based week
export function weekStart(key) {
  const d = parseKey(key);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toKey(d);
}

export function weekDays(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// "Tuesday, 06/10/2026"
export function formatDayLong(key) {
  const d = parseKey(key);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDayShort(key) {
  return parseKey(key).toLocaleDateString('en-GB', { weekday: 'short' });
}

export function meetingStart(m) {
  if (!m.meeting_date || !m.start_time) return null;
  const [h, min] = m.start_time.split(':').map(Number);
  const d = parseKey(m.meeting_date);
  d.setHours(h, min, 0, 0);
  return d;
}

// Linked project name, or a project name typed on the meeting
export function projectLabel(m) {
  return m?.project?.name || m?.project_name || '';
}

export function meetingTitle(m) {
  if (m.title) return m.title;
  if (projectLabel(m)) return `Meeting — ${projectLabel(m)}`;
  return 'Meeting';
}

export function initials(name) {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Per-device preferences (pop-up on/off, sound on/off). Browser
// storage can be unavailable (private mode), so never let it throw.
export function getPref(name, fallback) {
  try {
    const v = window.localStorage.getItem(`ace-pref-${name}`);
    return v === null ? fallback : v === 'true';
  } catch {
    return fallback;
  }
}

export function setPref(name, value) {
  try {
    window.localStorage.setItem(`ace-pref-${name}`, String(value));
  } catch {
    /* ignore */
  }
}

export function notifyMeetingsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ace-meetings-changed'));
}

// A friendly message when the one-time database update hasn't run yet
export function friendlyDbError(message = '') {
  if (/column .* does not exist|meetings_status_check|relationship|schema cache|reminder_default_minutes|start_time|assigned_to|is_done/i.test(message)) {
    return 'The planner needs a one-time database update before it can be used. Please ask your admin to run the "meetings planner" update in Supabase.';
  }
  return message;
}

// ---------- meeting status ----------
export const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function statusOf(m) {
  if (m?.status) return m.status;
  return m?.is_done ? 'completed' : 'pending';
}

export function statusLabel(value) {
  if (value === 'overdue') return 'Overdue';
  return STATUSES.find((s) => s.value === value)?.label || value;
}

// Only pending meetings ring / carry over
export function isActiveMeeting(m) {
  return statusOf(m) === 'pending';
}

// Pending, and its time has already passed (end time, or start + 1h,
// or the whole day for meetings without a time)
export function isOverdue(m, nowMs = Date.now()) {
  if (statusOf(m) !== 'pending' || !m.meeting_date) return false;
  const today = toKey(new Date(nowMs));
  if (m.meeting_date < today) return true;
  if (m.meeting_date > today || !m.start_time) return false;
  const end = parseKey(m.meeting_date);
  const t = (m.end_time || m.start_time).split(':').map(Number);
  end.setHours(t[0], t[1], 0, 0);
  if (!m.end_time) end.setMinutes(end.getMinutes() + 60);
  return nowMs > end.getTime();
}

// "Pending" includes overdue ones; "Overdue" is the late subset
export function matchesStatus(m, filter, nowMs = Date.now()) {
  if (!filter || filter === 'all') return true;
  if (filter === 'overdue') return isOverdue(m, nowMs);
  return statusOf(m) === filter;
}
