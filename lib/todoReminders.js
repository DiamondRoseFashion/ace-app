// To-Do notifications, run by the every-minute reminder job:
//  1) "Remind me" time reached → notify the person doing it
//     (and the person who gave it, if different).
//  2) Someone gave you a to-do → "New to-do from …".
//  3) 8 AM (UAE) → one summary of to-dos due today / overdue.
import { sendToUser } from '@/lib/pushServer';
import { localDateKey, COMPANY_UTC_OFFSET_MINUTES } from '@/lib/reminderSchedule';
import { ruleOf, nextAfter, describeRule } from '@/lib/repeatRule';

export const DIGEST_HOUR = 8; // UAE time

const fmtDue = (d) => (d ? d.split('-').reverse().join('/') : '');

// next daily reminder time after "now" (same time of day)
export function nextDaily(remindAt, now) {
  let t = new Date(remindAt).getTime();
  const DAY = 24 * 3600 * 1000;
  if (t <= now) t += Math.ceil((now - t + 1) / DAY) * DAY;
  return t;
}

function localHour(ms) {
  return new Date(ms + COMPANY_UTC_OFFSET_MINUTES * 60000).getUTCHours();
}

export async function runTodoNotifications(admin, now = Date.now()) {
  const out = [];
  const nowIso = new Date(now).toISOString();
  const today = localDateKey(now);
  const names = {};
  async function nameOf(id) {
    if (!id) return 'Someone';
    if (!(id in names)) {
      const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle();
      names[id] = (data?.full_name || '').trim() || 'Someone';
    }
    return names[id];
  }

  // 1) reminders that are due. One-off reminders more than a day late
  //    (e.g. after a long outage) are skipped; daily ones move on.
  const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();
  // newest columns first; older databases (SQL not run yet) fall back
  const BASE = 'id, title, due_date, assigned_to, created_by, remind_at';
  const tries = [
    { cols: `${BASE}, remind_repeat, remind_until, remind_unit, remind_every, remind_days`, repeat: true },
    { cols: `${BASE}, remind_repeat, remind_until`, repeat: true },
    { cols: BASE, repeat: false },
  ];
  let due = null; let error = null; let repeatOk = false;
  for (const tr of tries) {
    let q = admin.from('todos').select(tr.cols)
      .is('done_at', null).is('remind_sent_at', null).lte('remind_at', nowIso);
    q = tr.repeat ? q.or(`remind_repeat.neq.none,remind_at.gte.${dayAgo}`) : q.gte('remind_at', dayAgo);
    ({ data: due, error } = await q);
    repeatOk = tr.repeat;
    if (!error || !/remind_(repeat|until|unit|every|days)/.test(error.message)) break;
  }
  if (error) return { skipped: error.message }; // To-Do not set up yet
  for (const t of due || []) {
    const rule = repeatOk ? ruleOf(t) : null;
    const daily = !!rule;
    const late = now - new Date(t.remind_at).getTime() > 24 * 3600 * 1000;
    let claim;
    if (rule) {
      // move this reminder on to its next time (or finish it after the end date)
      const next = nextAfter(new Date(t.remind_at).getTime(), rule, COMPANY_UTC_OFFSET_MINUTES, now);
      const finished = t.remind_until && localDateKey(next) > t.remind_until;
      claim = admin.from('todos')
        .update(finished ? { remind_sent_at: nowIso } : { remind_at: new Date(next).toISOString() })
        .eq('id', t.id).eq('remind_at', t.remind_at).is('remind_sent_at', null);
    } else {
      claim = admin.from('todos').update({ remind_sent_at: nowIso })
        .eq('id', t.id).is('remind_sent_at', null);
    }
    const { data: claimed } = await claim.select('id');
    if (!claimed?.length || late) continue; // a missed day isn't sent late
    const body = `${t.title}${t.due_date ? `\nDue ${t.due_date === today ? 'today' : fmtDue(t.due_date)}` : ''}`;
    const r = await sendToUser(admin, t.assigned_to, {
      kind: 'todo', title: daily ? `🔁 To-Do reminder · ${describeRule(rule, new Date(t.remind_at).getTime(), COMPANY_UTC_OFFSET_MINUTES)}` : '⏰ To-Do reminder', body, url: '/todo', tag: `ace-todo-${t.id}`, sticky: true,
    });
    out.push({ todo: t.id, type: 'reminder', ...r });
    // delivery log (shows in troubleshooting, never emailed)
    await admin.from('app_events').insert({
      level: 'info', source: 'todo',
      message: `To-Do reminder "${String(t.title).slice(0, 80)}": ${r.delivered || 0} of ${r.devices || 0} device(s) reached${r.failures?.length ? `, failed: ${r.failures.map((f) => f.status || f.message).join(', ').slice(0, 200)}` : ''}`,
      detail: { todo: t.id, devices: r.devices, delivered: r.delivered, failures: r.failures || [] },
      user_id: t.assigned_to, fingerprint: 'todo-reminder-delivery',
    }).then(() => {}, () => {});
    if (t.created_by && t.created_by !== t.assigned_to) {
      const c = await sendToUser(admin, t.created_by, {
        kind: 'todo', title: '⏰ To-Do reminder', body: `${body}\nAssigned to ${await nameOf(t.assigned_to)}`,
        url: '/todo', tag: `ace-todo-copy-${t.id}`,
      });
      out.push({ todo: t.id, type: 'reminder-copy', ...c });
    }
  }

  // 2) newly given to-dos
  const { data: fresh } = await admin
    .from('todos')
    .select('id, title, due_date, assigned_to, created_by')
    .is('done_at', null).is('assign_notified_at', null);
  for (const t of fresh || []) {
    const { data: claimed } = await admin.from('todos').update({ assign_notified_at: nowIso })
      .eq('id', t.id).is('assign_notified_at', null).select('id');
    if (!claimed?.length || t.assigned_to === t.created_by) continue;
    const r = await sendToUser(admin, t.assigned_to, {
      kind: 'todo', title: `📝 New to-do from ${await nameOf(t.created_by)}`,
      body: `${t.title}${t.due_date ? `\nDue ${t.due_date === today ? 'today' : fmtDue(t.due_date)}` : ''}`,
      url: '/todo', tag: `ace-todo-new-${t.id}`,
    });
    out.push({ todo: t.id, type: 'assigned', ...r });
  }

  // 4) finished to-dos stay in the "Done" list for 7 days, then go
  if (Math.random() < 0.1) {
    await admin.from('todos').delete().not('done_at', 'is', null)
      .lt('done_at', new Date(now - 7 * 24 * 3600 * 1000).toISOString());
  }

  // 3) morning summary, once a day
  if (localHour(now) >= DIGEST_HOUR) {
    const { data: people } = await admin.from('todo_access').select('user_id, digest_date');
    for (const p of people || []) {
      if (p.digest_date && p.digest_date >= today) continue;
      const { data: claimed } = await admin.from('todo_access').update({ digest_date: today })
        .eq('user_id', p.user_id)
        .or(`digest_date.is.null,digest_date.lt.${today}`)
        .select('user_id');
      if (!claimed?.length) continue;
      const { data: list } = await admin.from('todos')
        .select('title, due_date, priority')
        .eq('assigned_to', p.user_id).is('done_at', null).lte('due_date', today)
        .order('due_date').limit(50);
      if (!list?.length) continue;
      const late = list.filter((t) => t.due_date < today).length;
      const top = [...list].sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1))
        .slice(0, 3).map((t) => `• ${t.title}`).join('\n');
      const r = await sendToUser(admin, p.user_id, {
        kind: 'todo',
        title: `✅ ${list.length} to-do${list.length === 1 ? '' : 's'} for today${late ? ` (${late} overdue)` : ''}`,
        body: top + (list.length > 3 ? `\n+ ${list.length - 3} more` : ''),
        url: '/todo', tag: 'ace-todo-digest',
      });
      out.push({ user: p.user_id, type: 'digest', count: list.length, ...r });
    }
  }
  return { sent: out };
}
