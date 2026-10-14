// A salesperson added people under "Supported By": send each of them a
// push notification ("New project to support") on their phones/computers.
import { NextResponse } from 'next/server';
import { adminClient, configurePush, sendToUser } from '@/lib/pushServer';
import { logEvent } from '@/lib/monitor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MANAGEMENT = ['owner', 'admin', 'manager'];

export async function POST(req) {
  const admin = adminClient();
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: { user } = {}, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body = {};
  try { body = await req.json(); } catch { /* empty */ }
  const projectId = body.projectId;
  const userIds = Array.isArray(body.userIds) ? body.userIds.filter((x) => typeof x === 'string').slice(0, 50) : [];
  if (!projectId || userIds.length === 0) return NextResponse.json({ error: 'Nothing to send' }, { status: 400 });

  // only the project's own salesperson (creator) or management may notify
  const [{ data: project }, { data: me }] = await Promise.all([
    admin.from('projects').select('id, name, sales_person, created_by').eq('id', projectId).maybeSingle(),
    admin.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle(),
  ]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (project.created_by !== user.id && !MANAGEMENT.includes(me?.role)) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  // only people who really are supporters of this project, never yourself
  const { data: rows } = await admin.from('project_supporters')
    .select('user_id').eq('project_id', projectId).in('user_id', userIds);
  const targets = [...new Set((rows || []).map((r) => r.user_id))].filter((id) => id !== user.id);
  if (targets.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  try { configurePush(); } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 200 }); }

  const from = project.sales_person || me?.full_name || 'a salesperson';
  const payload = {
    kind: 'support',
    title: '🛟 New project to support',
    body: `From ${from}: ${project.name || 'a project'}`,
    url: '/support',
    tag: `ace-support-${projectId}`,
    projectId,
  };
  const results = [];
  for (const uid of targets) {
    const r = await sendToUser(admin, uid, payload);
    results.push({ user: uid, ...r });
    if (r.failures?.length) {
      await logEvent(admin, {
        level: 'warning', source: 'support',
        message: `A "new project to support" notification couldn't be delivered to ${r.failures.length} device(s)`,
        detail: { project: projectId, failures: r.failures }, userId: uid,
        fingerprint: `support-push-fail|${r.failures[0]?.status || ''}`,
      });
    }
  }
  // record what happened (shows in Team & Access → monitoring, never emailed)
  await logEvent(admin, {
    level: 'info', source: 'support',
    message: `"New project to support" sent for ${project.name || 'a project'}`,
    detail: { project: projectId, by: user.id, people: results.map((r) => ({ user: r.user, devices: r.devices, delivered: r.delivered })) },
    userId: user.id, fingerprint: 'support-notify',
  });
  return NextResponse.json({ ok: true, sent: results.reduce((t, r) => t + r.delivered, 0), results });
}
