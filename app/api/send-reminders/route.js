// Called every minute by a Supabase schedule (pg_cron). Finds meetings
// whose reminder is due and pushes a notification to the assigned
// person's registered phones/computers — works even when ACE is closed.
import { NextResponse } from 'next/server';
import { adminClient, configurePush, sendToUser } from '@/lib/pushServer';
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
  try {
    configurePush();
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const admin = adminClient();
  const now = Date.now();
  const today = localDateKey(now);

  const { data: meetings, error } = await admin
    .from('meetings')
    .select('*, project:projects(name)')
    .eq('is_done', false)
    .not('assigned_to', 'is', null)
    .gte('meeting_date', shiftDateKey(today, -1))
    .lte('meeting_date', shiftDateKey(today, 1));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = [...new Set((meetings || []).map((m) => m.assigned_to))];
  const defaults = {};
  const repeatOn = {};
  if (userIds.length) {
    const { data: profs } = await admin.from('profiles').select('*').in('id', userIds);
    (profs || []).forEach((p) => {
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
  }

  return NextResponse.json({ ok: true, checked: (meetings || []).length, sent: results });
}

export async function POST(req) { return handle(req); }
export async function GET(req) { return handle(req); }
