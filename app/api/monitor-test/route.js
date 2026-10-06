// Owner/admin only: send a test alert, or the weekly report right now.
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/pushServer';
import { sendEmail, emailShell, emailConfigured, uaeTime } from '@/lib/monitor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  const admin = adminClient();
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { data: { user } = {} } = await admin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { data: prof } = await admin.from('profiles').select('role, full_name').eq('id', user.id).single();
  if (!prof || !['owner', 'admin'].includes(prof.role)) return NextResponse.json({ error: 'Only the owner or an admin can do this' }, { status: 403 });

  if (!emailConfigured()) {
    return NextResponse.json({ error: 'Email is not set up yet: add RESEND_API_KEY and ALERT_EMAIL in Vercel, then redeploy.' }, { status: 400 });
  }

  let what = 'alert';
  try { what = (await req.json())?.what === 'weekly' ? 'weekly' : 'alert'; } catch { /* default */ }

  if (what === 'weekly') {
    if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET is not set in Vercel' }, { status: 500 });
    const origin = new URL(req.url).origin;
    const res = await fetch(`${origin}/api/weekly-report`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json({ error: j.error || `Weekly report failed (${res.status})` }, { status: 500 });
    return NextResponse.json({ ok: true, message: 'Weekly report sent — check your inbox.' });
  }

  const sent = await sendEmail({
    subject: '🔔 ACE monitor test — alerts are working',
    html: emailShell('Test alert', `<p>This is a test sent by <b>${prof.full_name || user.email}</b> on ${uaeTime(new Date().toISOString())}.</p>
      <p>If you can read this, ACE can reach you: real problems will arrive here the moment they're detected, and the weekly report every Monday at 8:00 AM.</p>`),
  });
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 500 });
  return NextResponse.json({ ok: true, message: 'Test alert sent — check your inbox.' });
}
