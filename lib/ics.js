// Builds iCalendar (.ics) files — the standard calendar format that
// Outlook, Google Calendar and Apple Calendar all read.
// Meeting times are stored as UAE local time; we write them in UTC so
// every calendar app shows the right time wherever the viewer is.

const UTC_OFFSET_MINUTES = 4 * 60; // UAE, no daylight saving
const DEFAULT_DURATION_MIN = 60;

function pad(n) { return String(n).padStart(2, '0'); }

function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function localToUtcMs(dateKey, time) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - UTC_OFFSET_MINUTES * 60000;
}

function dateOnly(dateKey, addDays = 0) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + addDays));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 bytes must be folded (continuation lines start
// with a space). Fold on characters, keeping multi-byte chars whole.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + b > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += b;
  }
  parts.push(current);
  return parts.map((p, i) => (i === 0 ? p : ` ${p}`)).join('\r\n');
}

function meetingName(m) {
  if (m.title) return m.title;
  if (m.project?.name || m.project_name) return `Meeting — ${m.project?.name || m.project_name}`;
  return 'Meeting';
}

export function meetingEvent(m, { reminderDefault = 60, nowMs = Date.now() } = {}) {
  const lines = ['BEGIN:VEVENT'];
  lines.push(`UID:ace-meeting-${m.id}@gemssystems.com`);
  lines.push(`DTSTAMP:${utcStamp(nowMs)}`);
  if (m.updated_at || m.created_at) lines.push(`LAST-MODIFIED:${utcStamp(Date.parse(m.updated_at || m.created_at))}`);

  if (m.start_time) {
    const start = localToUtcMs(m.meeting_date, m.start_time);
    let end = m.end_time ? localToUtcMs(m.meeting_date, m.end_time) : start + DEFAULT_DURATION_MIN * 60000;
    if (end <= start) end = start + DEFAULT_DURATION_MIN * 60000;
    lines.push(`DTSTART:${utcStamp(start)}`);
    lines.push(`DTEND:${utcStamp(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(m.meeting_date)}`);
    lines.push(`DTEND;VALUE=DATE:${dateOnly(m.meeting_date, 1)}`);
    lines.push('X-MICROSOFT-CDO-BUSYSTATUS:FREE');
    lines.push('TRANSP:TRANSPARENT');
  }

  const status = m.status || (m.is_done ? 'completed' : 'pending');
  const prefix = { completed: '✓ ', cancelled: 'Cancelled: ', postponed: 'Postponed: ' }[status] || '';
  lines.push(`SUMMARY:${escapeText(prefix + meetingName(m))}`);
  if (m.venue) lines.push(`LOCATION:${escapeText(m.venue)}`);

  const desc = [];
  if (m.project?.name || m.project_name) desc.push(`Project: ${m.project?.name || m.project_name}`);
  if (m.assignee?.full_name) desc.push(`Assigned to: ${m.assignee.full_name}`);
  if (m.notes) desc.push(`Notes: ${m.notes}`);
  if (m.actions) desc.push(`Course of actions: ${m.actions}`);
  desc.push('Open in ACE: https://app.gemssystems.com/planner');
  lines.push(`DESCRIPTION:${escapeText(desc.join('\n'))}`);
  lines.push('URL:https://app.gemssystems.com/planner');
  lines.push(`STATUS:${status === 'cancelled' ? 'CANCELLED' : status === 'postponed' ? 'TENTATIVE' : 'CONFIRMED'}`);

  const rem = m.reminder_minutes ?? reminderDefault;
  if (m.start_time && rem != null && rem >= 0 && status === 'pending') {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(meetingName(m))}`, `TRIGGER:-PT${rem}M`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

export function buildCalendar(meetings, { name = 'ACE Meetings', reminderDefault = 60, nowMs = Date.now() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gems Systems//ACE//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Asia/Dubai',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const m of meetings) lines.push(...meetingEvent(m, { reminderDefault, nowMs }));
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
