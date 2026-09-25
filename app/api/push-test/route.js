// "Send a test notification" button: pushes a test reminder to all of
// the signed-in person's own registered devices.
import { NextResponse } from 'next/server';
import { adminClient, configurePush, sendToUser } from '@/lib/pushServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });

  try {
    configurePush();
  } catch {
    return NextResponse.json({ error: 'Background notifications are not switched on yet (missing server key in Vercel).' }, { status: 500 });
  }

  const admin = adminClient();
  const { data: { user } = {}, error } = await admin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });

  const r = await sendToUser(admin, user.id, {
    title: '🔔 Test reminder from ACE',
    body: 'Background notifications work on this device.',
    tag: 'ace-test',
    url: '/planner',
  });
  if (r.devices === 0) {
    return NextResponse.json({ error: 'No devices registered yet. Tap "Turn on notifications" first.' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...r });
}
