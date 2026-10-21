// Called every minute by a Supabase schedule (pg_cron). Finds meetings
// whose reminder is due and pushes a notification to the assigned
// person's registered phones/computers — works even when ACE is closed.
import { NextResponse } from 'next/server';
import { adminClient, configurePush, sendToUser } from '@/lib/pushServer';
import { logEvent, heartbeat } from '@/lib/monitor';
import { runTodoNotifications } from '@/lib/todoReminders';
import { pushAction, notificationFor, localDateKey, shiftDateKey, MAX_REPEATS } from '@/lib/reminderSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('x-cron-secret') || '';
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return header === secret || bearer === secret;
}

async function handle(req) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = adminClient();
  try {
    configurePush();
  } catch (e) {
    await logEvent(admin, { level: 'critical', source: 'reminders', message: `Reminders can't be sent: ${e.message}`, fingerprint: 'reminders-config' });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const now = Date.now();
  const today = localDateKey(now);

  const { data: meetings, error } = await admin
    .from('meetings')
    .select('*, project:projects(name)')
    .eq('is_done', false)
    .not('assigned_to', 'is', null)
    .gte('meeting_date', shiftDateKey(today, -1))
    .lte('meeting_date', shiftDateKey(today, 1));
  if (error) {
    await logEvent(admin, { level: 'critical', source: 'reminders', message: `Reminders job can't read meetings: ${error.message}`, fingerprint: 'reminders-db' });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = [...new Set((meetings || []).flatMap((m) => [m.assigned_to, m.created_by]).filter(Boolean))];
  const defaults = {};
  const repeatOn = {};
  const names = {};
  if (userIds.length) {
    const { data: profs } = await admin.from('profiles').select('*').in('id', userIds);
    (profs || []).forEach((p) => {
      names[p.id] = p.full_name;
      defaults[p.id] = p.reminder_default_minutes;
      repeatOn[p.id] = false; // reminders ring once (no every-minute repeats)
    });
  }

  const results = [];
  const nowIso = new Date(now).toISOString();
  for (const m of meetings || []) {
    const action = pushAction(m, defaults[m.assigned_to], repeatOn[m.assigned_to], now);
    if (!action) continue;
    const { w } = action;

    // Claim first, so overlapping runs never double-send
    let claim;
    if (action.type === 'first') {
      claim = admin.from('meetings')
        .update({ push_sent_key: w.key, push_repeat_count: 0, push_last_sent_at: nowIso })
        .eq('id', m.id)
        .or(`push_sent_key.is.null,push_sent_key.neq.${w.key}`);
    } else {
      const count = m.push_repeat_count || 0;
      claim = admin.from('meetings')
        .update({ push_repeat_count: count + 1, push_last_sent_at: nowIso })
        .eq('id', m.id)
        .eq('push_sent_key', w.key)
        .eq('push_repeat_count', count);
    }
    const { data: claimed } = await claim.select('id');
    if (!claimed || claimed.length === 0) continue;

    const note = notificationFor(m, w, now);
    const repeatNo = action.type === 'repeat' ? (m.push_repeat_count || 0) + 1 : 0;
    const payload = {
      ...note,
      meetingId: m.id,
      repeat: repeatNo,
      actions: true,
      body: repeatOn[m.assigned_to] !== false && repeatNo < MAX_REPEATS
        ? `${note.body}\nRepeats every minute until you tap Stop`
        : note.body,
    };
    const r = await sendToUser(admin, m.assigned_to, payload);
    results.push({ meeting: m.id, type: action.type, repeat: repeatNo, ...r });

    // The person who set the meeting up for someone else (manager / admin /
    // owner) gets the same reminder too, once, as a normal notification.
    if (action.type === 'first' && m.created_by && m.created_by !== m.assigned_to) {
      const who = names[m.assigned_to] || 'your team member';
      const copy = await sendToUser(admin, m.created_by, {
        kind: 'meeting-copy',
        title: note.title,
        body: `${note.body}\nAssigned to ${who}`,
        url: '/planner',
        tag: `ace-meeting-copy-${m.id}`,
      });
      results.push({ meeting: m.id, type: 'copy-to-creator', ...copy });
    }
    if (r.failures?.length) {
      await logEvent(admin, {
        level: 'warning', source: 'reminders',
        message: `A reminder notification couldn't be delivered to ${r.failures.length} device(s)`,
        detail: { meeting: m.id, title: m.title || null, failures: r.failures },
        userId: m.assigned_to, fingerprint: `push-fail|${r.failures[0]?.status || ''}`,
      });
    }
  }

  // To-Do reminders / new to-dos / 8 AM summary (never stops the meeting reminders)
  let todo = null;
  try { todo = await runTodoNotifications(admin, now); } catch (e) {
    todo = { error: e.message };
    await logEvent(admin, { level: 'warning', source: 'reminders', message: `To-Do notifications failed: ${e.message}`, fingerprint: 'todo-reminders' });
  }

  await heartbeat(admin, 'reminders', { checked: (meetings || []).length, sent: results.length });

  return NextResponse.json({ ok: true, checked: (meetings || []).length, sent: results, todo });
}

export async function POST(req) { return handle(req); }
export async function GET(req) { return handle(req); }
