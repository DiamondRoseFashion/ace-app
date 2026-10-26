// Repeating reminders (To-Do), shared by the page and the reminder job.
// A rule: { unit: 'day' | 'week' | 'month', every: N, days: [0..6] }
//   days = weekdays for weekly rules (0 = Sunday … 6 = Saturday),
//          or [day of month] for monthly rules (so the 31st stays the 31st).
// All maths is done on the local wall clock (offsetMinutes from UTC),
// so "9:00 AM" stays 9:00 AM whatever day it lands on.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY = 86400000;

export function ruleOf(t) {
  if (!t) return null;
  if (t.remind_repeat === 'daily') return { unit: 'day', every: 1, days: [] };
  if (t.remind_repeat !== 'custom') return null;
  const unit = ['day', 'week', 'month'].includes(t.remind_unit) ? t.remind_unit : 'day';
  const every = Math.max(1, Math.min(99, Number(t.remind_every) || 1));
  const raw = (t.remind_days || []).map(Number);
  const days = unit === 'week' ? [...new Set(raw.filter((d) => d >= 0 && d <= 6))].sort()
    : unit === 'month' ? raw.filter((d) => d >= 1 && d <= 31).slice(0, 1) : [];
  return { unit, every, days };
}

// local wall-clock helpers (a Date whose UTC fields = local time)
const toLocal = (ms, off) => new Date(ms + off * 60000);
const fromLocal = (d, off) => d.getTime() - off * 60000;
const weekStart = (d) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - x.getUTCDay()); x.setUTCHours(0, 0, 0, 0); return x.getTime(); };

function matches(local, rule) {
  return rule.unit !== 'week' || !rule.days.length || rule.days.includes(local.getUTCDay());
}

// the next time after `ms` that the rule fires
export function stepRule(ms, rule, off) {
  const cur = toLocal(ms, off);
  if (rule.unit === 'day') { cur.setUTCDate(cur.getUTCDate() + rule.every); return fromLocal(cur, off); }
  if (rule.unit === 'month') {
    const day = rule.days[0] || cur.getUTCDate();
    const n = new Date(cur); n.setUTCDate(1); n.setUTCMonth(n.getUTCMonth() + rule.every);
    const last = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0)).getUTCDate();
    n.setUTCDate(Math.min(day, last)); // 31st → last day of shorter months
    return fromLocal(n, off);
  }
  // weekly
  if (!rule.days.length) { cur.setUTCDate(cur.getUTCDate() + 7 * rule.every); return fromLocal(cur, off); }
  const startWeek = weekStart(cur);
  const c = new Date(cur);
  for (let i = 0; i < 7 * rule.every + 7; i++) {
    c.setUTCDate(c.getUTCDate() + 1);
    const weeks = Math.round((weekStart(c) - startWeek) / (7 * DAY));
    if (weeks % rule.every === 0 && rule.days.includes(c.getUTCDay())) return fromLocal(c, off);
  }
  return fromLocal(c, off);
}

// first time the rule fires at/after `ms` (start date) and after `now`
export function firstFire(ms, rule, off, now) {
  let t = ms;
  if (!matches(toLocal(t, off), rule)) {
    // move to the first chosen weekday in the start week or later
    const c = toLocal(t, off);
    for (let i = 0; i < 7 && !matches(c, rule); i++) c.setUTCDate(c.getUTCDate() + 1);
    t = fromLocal(c, off);
  }
  for (let i = 0; t <= now && i < 5000; i++) t = stepRule(t, rule, off);
  return t;
}

// the next one strictly after `now` (used by the reminder job after firing)
export function nextAfter(ms, rule, off, now) {
  let t = stepRule(ms, rule, off);
  for (let i = 0; t <= now && i < 5000; i++) t = stepRule(t, rule, off);
  return t;
}

const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

// "Every day", "Mon–Fri", "Every 2 weeks on Mon, Thu", "Monthly on the 5th"
export function describeRule(rule, startMs, off) {
  if (!rule) return '';
  const n = rule.every;
  if (rule.unit === 'day') return n === 1 ? 'Every day' : `Every ${n} days`;
  if (rule.unit === 'month') {
    const dom = rule.days[0] || (startMs ? toLocal(startMs, off).getUTCDate() : 0);
    const day = dom ? ordinal(dom) : '';
    return `${n === 1 ? 'Monthly' : `Every ${n} months`}${day ? ` on the ${day}` : ''}`;
  }
  const days = rule.days.length ? rule.days : (startMs ? [toLocal(startMs, off).getUTCDay()] : []);
  const list = days.join(',') === '1,2,3,4,5' ? 'Mon–Fri' : days.map((d) => WEEKDAYS[d]).join(', ');
  if (n === 1) return days.length === 7 ? 'Every day' : `Weekly on ${list}`;
  return `Every ${n} weeks on ${list}`;
}
