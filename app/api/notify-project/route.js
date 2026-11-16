// A project was saved for someone else: tell its Sales Person (and its
// Prepared By person, if someone else picked them) with a phone/computer
// notification that opens the project. Only people working on the
// project (or management) can send it, and never to themselves.
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
  const projectId = typeof body.projectId === 'string' ? body.projectId : null;
  if (!projectId) return NextResponse.json({ error: 'Nothing to send' }, { status: 400 });

  const [{ data: project }, { data: me }] = await Promise.all([
    admin.from('projects').select('id, name, sales_person, created_by, prepared_by, sales_user_id').eq('id', projectId).maybeSingle(),
    admin.from('profiles').select('full_name, role').eq('id', user.id).maybeSingle(),
  ]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  const member = [project.created_by, project.prepared_by, project.sales_user_id].includes(user.id);
  if (!member && !MANAGEMENT.includes(me?.role)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const targets = [...new Set([project.sales_user_id, project.prepared_by].filter((id) => id && id !== user.id))];
  if (targets.length === 0) return NextResponse.json({ ok: true, sent: 0 });

  try { configurePush(); } catch (e) { return NextResponse.json({ ok: false, error: e.message }, { status: 200 }); }

  let preparer = me?.full_name || 'someone';
  if (project.prepared_by && project.prepared_by !== user.id) {
    const { data: p } = await admin.from('profiles').select('full_name').eq('id', project.prepared_by).maybeSingle();
    if (p?.full_name) preparer = p.full_name;
  }
  const results = [];
  for (const uid of targets) {
    const forSales = uid === project.sales_user_id;
    const r = await sendToUser(admin, uid, {
      kind: 'project',
      title: forSales ? '📁 New project for you' : '📁 You were set as Prepared By',
      body: `${project.name || 'A project'}${forSales ? ` · prepared by ${preparer}` : ` · sales person ${project.sales_person || '—'}`}`,
      url: `/project/${project.id}`,
      tag: `ace-project-${project.id}-${forSales ? 'sales' : 'prep'}`,
    });
    results.push({ user: uid, ...r });
    if (r.failures?.length) {
      await logEvent(admin, {
        level: 'warning', source: 'projects',
        message: `A "new project for you" notification couldn't be delivered to ${r.failures.length} device(s)`,
        detail: { project: projectId, failures: r.failures }, userId: uid,
      });
    }
  }
  return NextResponse.json({ ok: true, sent: results.length });
}
