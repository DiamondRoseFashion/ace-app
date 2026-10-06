// Nightly (2:00 AM UAE): saves a full copy of all ACE data to the
// private "backups" storage area and keeps the last 14 nights.
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/pushServer';
import { cronAuthorized, logEvent, heartbeat } from '@/lib/monitor';
import { buildFullBackup, BACKUP_BUCKET, NIGHTLY_PREFIX, KEEP_NIGHTLY } from '@/lib/fullBackup';
import { localDateKey } from '@/lib/reminderSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = adminClient();
  try {
    const backup = await buildFullBackup(admin);
    const name = `${NIGHTLY_PREFIX}/ace-backup-${localDateKey(Date.now())}.json`;
    const body = Buffer.from(JSON.stringify(backup));
    const { error: upErr } = await admin.storage.from(BACKUP_BUCKET)
      .upload(name, body, { contentType: 'application/json', upsert: true });
    if (upErr) throw new Error(`saving the backup failed: ${upErr.message}`);

    // keep the newest KEEP_NIGHTLY
    const { data: list } = await admin.storage.from(BACKUP_BUCKET).list(NIGHTLY_PREFIX, { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
    const old = (list || []).filter((f) => f.name.startsWith('ace-backup-')).slice(KEEP_NIGHTLY);
    if (old.length) await admin.storage.from(BACKUP_BUCKET).remove(old.map((f) => `${NIGHTLY_PREFIX}/${f.name}`));

    await heartbeat(admin, 'backup', { file: name, bytes: body.length, counts: backup.counts });
    return NextResponse.json({ ok: true, file: name, bytes: body.length, counts: backup.counts });
  } catch (e) {
    await logEvent(admin, { level: 'critical', source: 'backup', message: `Nightly backup failed: ${e.message}`, fingerprint: 'backup-failed' });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) { return handle(req); }
export async function GET(req) { return handle(req); }
