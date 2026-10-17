// A manager / admin / owner gave a meeting to someone else: tell that
// person straight away on their phones/computers ("New meeting").
import { NextResponse } from 'next/server';
import { adminClient, configurePush, sendToUser } from '@/lib/pushServer';
import { logEvent } from '@/lib/monitor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MANAGEMENT = ['owner', 'admin', 'manager'];
const p2 = (n) => String(n).padStart(2, '0');
const dmy = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const t12 = (t) => { if (!t) return ''; const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}:${p2(m)} ${h >= 12 ? 'PM' : 'AM'}`; };

export async function POST(req) {
  const admin = adminClient();
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user } = {}, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (!body.meetingId) return NextResponse.json({ error: 'Nothing to send' }, { status: 400 });

  const [{ data: m }, { data: me }] = await Promise.all([
    admin.from('meetings').select('id, title, meeting_date, start_time, venue, assigned_to, created_by, project_name, project:projects(name)').eq('id', body.meetingId).maybeSingle(),
    admin.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle(),
  ]);
  if (!m) return NextResponse.json({ error: 'Meeting not found' }, { status: 404 });
  // only owner / admin / manager can give meetings to other people
  if (!MANAGEMENT.includes(me?.role)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }
  if (!m.assigned_to || m.assigned_to === user.id) return NextResponse.json({ ok: true, sent: 0 });

  try { configurePush(); } catch (e) { return NextResponse.json({ ok: false, error: e.message }); }

  const proj = m.project?.name || m.project_name || '';
  const when = [dmy(m.meeting_date), t12(m.start_time)].filter(Boolean).join(', ');
  const payload = {
    kind: 'meeting-assigned',
    title: `📅 New meeting from ${me?.full_name || 'your manager'}`,
    body: [m.title || 'Meeting', when, m.venue && `📍 ${m.venue}`, proj && `📁 ${proj}`].filter(Boolean).join(' · '),
    url: '/planner',
    tag: `ace-meeting-${m.id}`,
  };
  const r = await sendToUser(admin, m.assigned_to, payload);
  await logEvent(admin, {
    level: r.failures?.length ? 'warning' : 'info', source: 'meetings',
    message: `"New meeting" sent: ${m.title || 'Meeting'}`,
    detail: { meeting: m.id, to: m.assigned_to, devices: r.devices, delivered: r.delivered, failures: r.failures },
    userId: user.id, fingerprint: r.failures?.length ? `meeting-push-fail|${r.failures[0]?.status || ''}` : 'meeting-notify',
  });
  return NextResponse.json({ ok: true, sent: r.delivered, devices: r.devices });
}
