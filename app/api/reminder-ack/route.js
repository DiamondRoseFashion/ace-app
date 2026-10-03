// Called by the service worker when someone presses Stop / Snooze on a
// reminder notification, taps it, or swipes it away — even with ACE
// closed. The device's own push registration (a long secret URL only
// that device and our server know) proves who is acknowledging.
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/pushServer';
import { MAX_REPEATS } from '@/lib/reminderSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SNOOZE_MINUTES = 5;

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const { endpoint, meetingId, action, userId } = body || {};

  // A device now used by someone else got a reminder meant for its
  // previous owner: unregister it from that previous owner.
  if (action === 'release') {
    if (!endpoint || !userId) return NextResponse.json({ error: 'bad request' }, { status: 400 });
    await adminClient().from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', userId);
    return NextResponse.json({ ok: true, action });
  }

  if (!endpoint || !meetingId || !['stop', 'snooze', 'open'].includes(action)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const admin = adminClient();
  const [{ data: sub }, { data: meeting }] = await Promise.all([
    admin.from('push_subscriptions').select('user_id').eq('endpoint', endpoint).maybeSingle(),
    admin.from('meetings').select('id, assigned_to, push_repeat_count').eq('id', meetingId).maybeSingle(),
  ]);
  if (!sub || !meeting || meeting.assigned_to !== sub.user_id) {
    return NextResponse.json({ error: 'not allowed' }, { status: 403 });
  }

  const now = Date.now();
  const update = action === 'snooze'
    ? {
      push_snooze_until: new Date(now + SNOOZE_MINUTES * 60000).toISOString(),
      // always allow at least one more ring after a snooze
      push_repeat_count: Math.min(meeting.push_repeat_count || 0, MAX_REPEATS - 1),
    }
    : { push_ack_at: new Date(now).toISOString() };

  const { error } = await admin.from('meetings').update(update).eq('id', meetingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, action });
}
