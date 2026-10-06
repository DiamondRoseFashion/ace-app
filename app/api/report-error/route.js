// Browsers report errors here (page crashes, failed database calls).
// Rate-limited so one bug can't flood the log.
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/pushServer';
import { logEvent, fingerprintOf } from '@/lib/monitor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PER_BUG_PER_HOUR = 20;
const ALL_PER_HOUR = 400;

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const message = String(body?.message || '').slice(0, 500);
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });
  const path = String(body?.path || '').slice(0, 300);
  const kind = ['crash', 'database', 'api', 'promise'].includes(body?.kind) ? body.kind : 'crash';

  const admin = adminClient();

  // who (optional – errors can happen before sign-in)
  let userId = null;
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (token) {
    try {
      const { data } = await admin.auth.getUser(token);
      userId = data?.user?.id || null;
    } catch { /* ignore */ }
  }

  const source = `browser:${kind}`;
  const fingerprint = fingerprintOf(source, body?.status ? `${body.status} ${body?.endpoint || ''} ${message}` : message, path);
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const [{ count: same }, { count: all }] = await Promise.all([
    admin.from('app_events').select('id', { count: 'exact', head: true }).eq('fingerprint', fingerprint).gte('created_at', hourAgo),
    admin.from('app_events').select('id', { count: 'exact', head: true }).like('source', 'browser:%').gte('created_at', hourAgo),
  ]);
  if ((same || 0) >= PER_BUG_PER_HOUR || (all || 0) >= ALL_PER_HOUR) {
    return NextResponse.json({ ok: true, dropped: true });
  }

  await logEvent(admin, {
    level: 'error',
    source,
    message,
    path,
    userId,
    fingerprint,
    detail: {
      status: body?.status ?? null,
      endpoint: body?.endpoint ?? null,
      stack: body?.stack ?? null,
      browser: (req.headers.get('user-agent') || '').slice(0, 200),
    },
  });
  return NextResponse.json({ ok: true });
}
