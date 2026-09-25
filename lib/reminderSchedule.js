// Server-side reminder timing. Meeting dates/times are stored as
// local UAE time (no time zone), while servers run in UTC, so we
// convert using the company's fixed offset (UAE has no daylight
// saving: always UTC+4).

export const COMPANY_UTC_OFFSET_MINUTES = 4 * 60;
export const DEFAULT_REMINDER = 60; // minutes before start, when none chosen
export const ANYTIME_REMINDER_HOUR = 9; // meetings with no start time
export const SHOW_UNTIL_AFTER_START_MS = 10 * 60 * 1000;

function localFields(ms) {
  const d = new Date(ms + COMPANY_UTC_OFFSET_MINUTES * 60000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

export function localDateKey(ms) {
  const { y, m, d } = localFields(ms);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function shiftDateKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// UTC milliseconds for a local UAE date + "HH:MM[:SS]"
export function localToUtcMs(dateKey, time) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - COMPANY_UTC_OFFSET_MINUTES * 60000;
}

// When this meeting's reminder should fire. null = no reminder.
// `key` identifies this exact reminder so it's only sent once, and is
// re-sent if the meeting's date/time/reminder is changed.
export function reminderWindow(meeting, userDefault) {
  if (!meeting.meeting_date) return null;
  const mins = meeting.reminder_minutes ?? userDefault ?? DEFAULT_REMINDER;
  if (mins < 0) return null;
  if (meeting.start_time) {
    const start = localToUtcMs(meeting.meeting_date, meeting.start_time);
    const hhmm = meeting.start_time.slice(0, 5).replace(':', '');
    return {
      fireAt: start - mins * 60000,
      until: start + SHOW_UNTIL_AFTER_START_MS,
      start,
      key: `${meeting.meeting_date}_${hhmm}_${mins}`,
    };
  }
  const fireAt = localToUtcMs(meeting.meeting_date, `${String(ANYTIME_REMINDER_HOUR).padStart(2, '0')}:00`);
  const until = localToUtcMs(shiftDateKey(meeting.meeting_date, 1), '00:00') - 1;
  return { fireAt, until, start: null, key: `${meeting.meeting_date}_anytime` };
}

export function isDue(meeting, userDefault, nowMs) {
  if (meeting.is_done) return null;
  const w = reminderWindow(meeting, userDefault);
  if (!w) return null;
  if (nowMs < w.fireAt || nowMs > w.until) return null;
  if (meeting.push_sent_key === w.key) return null;
  return w;
}

function fmt12(time) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function notificationFor(meeting, window, nowMs) {
  const name = meeting.title || (meeting.project?.name ? `Meeting — ${meeting.project.name}` : 'Meeting');
  let when;
  if (!window.start) {
    when = 'Today · no set time';
  } else {
    const minsLeft = Math.round((window.start - nowMs) / 60000);
    if (minsLeft >= 60) {
      const h = Math.floor(minsLeft / 60);
      const r = minsLeft % 60;
      when = `Starts in ${h} hr${r ? ` ${r} min` : ''}`;
    } else if (minsLeft > 0) when = `Starts in ${minsLeft} min`;
    else if (minsLeft === 0) when = 'Starting now';
    else when = `Started ${-minsLeft} min ago`;
    when += ` · ${fmt12(meeting.start_time)}`;
  }
  const extra = [meeting.venue && `📍 ${meeting.venue}`, meeting.project?.name && `📁 ${meeting.project.name}`]
    .filter(Boolean).join(' · ');
  return {
    title: `🔔 ${name}`,
    body: extra ? `${when}\n${extra}` : when,
    tag: `meeting-${meeting.id}`,
    url: '/planner',
  };
}
