// Called every minute by a Supabase schedule (pg_cron). Finds meetings
// whose reminder is due and pushes a notification to the assigned
// person's registered phones/computers — works even when ACE is closed.
import { NextResponse } from 'next/server';
import { adminClient, configurePush, sendToUser } from '@/lib/pushServer';
import { isDue, notificationFor, localDateKey, shiftDateKey } from '@/lib/reminderSchedule';

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
    .select('id, title, meeting_date, start_time, venue, reminder_minutes, assigned_to, is_done, push_sent_key, project:projects(name)')
    .eq('is_done', false)
    .not('assigned_to', 'is', null)
    .gte('meeting_date', shiftDateKey(today, -1))
    .lte('meeting_date', shiftDateKey(today, 1));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const userIds = [...new Set((meetings || []).map((m) => m.assigned_to))];
  const defaults = {};
  if (userIds.length) {
    const { data: profs } = await admin.from('profiles').select('id, reminder_default_minutes').in('id', userIds);
    (profs || []).forEach((p) => { defaults[p.id] = p.reminder_default_minutes; });
  }

  const results = [];
  for (const m of meetings || []) {
    const w = isDue(m, defaults[m.assigned_to], now);
    if (!w) continue;
    // Claim this reminder first so overlapping runs never double-send
    const { data: claimed } = await admin
      .from('meetings')
      .update({ push_sent_key: w.key })
      .eq('id', m.id)
      .or(`push_sent_key.is.null,push_sent_key.neq.${w.key}`)
      .select('id');
    if (!claimed || claimed.length === 0) continue;
    const r = await sendToUser(admin, m.assigned_to, notificationFor(m, w, now));
    results.push({ meeting: m.id, ...r });
  }

  return NextResponse.json({ ok: true, checked: (meetings || []).length, sent: results });
}

export async function POST(req) { return handle(req); }
export async function GET(req) { return handle(req); }
