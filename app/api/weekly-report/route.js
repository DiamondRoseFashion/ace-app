// Every Monday 8:00 AM UAE: emails the weekly ACE report —
// health (errors, reminders, backups), the week's activity, and a
// full backup attached (Excel to read + JSON to restore from).
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/pushServer';
import { cronAuthorized, logEvent, heartbeat, sendEmail, esc, uaeTime, emailShell } from '@/lib/monitor';
import { buildBackupWorkbook } from '@/lib/backupWorkbook';
import { buildFullBackup, BACKUP_BUCKET, NIGHTLY_PREFIX } from '@/lib/fullBackup';
import { PROJECT_STATUSES } from '@/lib/projectStatus';
import { localDateKey } from '@/lib/reminderSchedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const DAY = 24 * 3600 * 1000;

function stat(label, value, color = '#0F1F3D') {
  return `<td style="padding:10px 12px;border:1px solid #E8E1EF;border-radius:8px;text-align:center;width:25%">
    <div style="font-size:22px;font-weight:700;color:${color}">${esc(value)}</div>
    <div style="font-size:12px;color:#7A6C86">${esc(label)}</div></td>`;
}

function section(title, html) {
  return `<h3 style="margin:22px 0 8px;font-size:15px;color:#6B2D82;border-bottom:1px solid #E8E1EF;padding-bottom:6px">${esc(title)}</h3>${html}`;
}

function ok(good, text) {
  return `<div style="margin:4px 0">${good ? '✅' : '❌'} ${text}</div>`;
}

async function handle(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = adminClient();
  const now = Date.now();
  const since = new Date(now - 7 * DAY).toISOString();
  const today = localDateKey(now);
  const nextWeek = localDateKey(now + 7 * DAY);

  try {
    const [
      { data: events }, { data: hbs }, { data: projects }, { data: profiles },
      { data: meetingsNew }, { data: meetingsWeek }, { data: quotesNew }, { data: nightly },
    ] = await Promise.all([
      admin.from('app_events').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(2000),
      admin.from('app_heartbeats').select('*'),
      admin.from('projects').select('id, name, status, created_at, created_by'),
      admin.from('profiles').select('id, full_name, role'),
      admin.from('meetings').select('id, status, is_done').gte('created_at', since),
      admin.from('meetings').select('id, meeting_date, status, is_done').gte('meeting_date', today).lte('meeting_date', nextWeek),
      admin.from('quotations').select('id').gte('created_at', since),
      admin.storage.from(BACKUP_BUCKET).list(NIGHTLY_PREFIX, { limit: 100, sortBy: { column: 'name', order: 'desc' } }),
    ]);
    const names = Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name || 'Unnamed']));

    // active users (signed in this week)
    let activeUsers = null;
    try {
      const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
      activeUsers = (data?.users || []).filter((u) => u.last_sign_in_at && u.last_sign_in_at >= since)
        .map((u) => names[u.id] || u.email);
    } catch { /* optional */ }

    // ----- health -----
    const ev = events || [];
    const problems = ev.filter((e) => e.level === 'critical' || e.level === 'error');
    const warnings = ev.filter((e) => e.level === 'warning');
    const deleted = ev.filter((e) => e.fingerprint === 'project-deleted');
    const byFp = new Map();
    problems.forEach((e) => {
      const g = byFp.get(e.fingerprint) || { message: e.message, level: e.level, path: e.path, count: 0, last: e.created_at };
      g.count += 1;
      if (e.level === 'critical') g.level = 'critical';
      byFp.set(e.fingerprint, g);
    });
    const topProblems = [...byFp.values()].sort((a, b) => b.count - a.count).slice(0, 10);

    const hb = Object.fromEntries((hbs || []).map((h) => [h.key, h]));
    const remindersOk = hb.reminders && now - Date.parse(hb.reminders.at) < 15 * 60 * 1000;
    const monitorOk = hb.monitor && now - Date.parse(hb.monitor.at) < 15 * 60 * 1000;
    const weekBackups = (nightly || []).filter((f) => f.name.startsWith('ace-backup-') && f.name.slice(11, 21) >= localDateKey(now - 7 * DAY));
    const backupOk = hb.backup && now - Date.parse(hb.backup.at) < 26 * 3600 * 1000;

    const healthGood = problems.length === 0 && remindersOk && backupOk && monitorOk;

    // ----- activity -----
    const newProjects = (projects || []).filter((p) => p.created_at >= since);
    const statusCounts = PROJECT_STATUSES.map((s) => ({ ...s, n: (projects || []).filter((p) => p.status === s.value).length })).filter((s) => s.n);
    const upcoming = (meetingsWeek || []).filter((m) => !m.is_done && (m.status || 'pending') === 'pending').length;

    // ----- backup attachments -----
    const attachments = [];
    const xlsx = await buildBackupWorkbook(admin, { full: true });
    if (xlsx.buffer) attachments.push({ filename: `ACE-backup-${today}.xlsx`, content: xlsx.buffer });
    const full = await buildFullBackup(admin);
    attachments.push({ filename: `ACE-full-backup-${today}.json`, content: Buffer.from(JSON.stringify(full)) });

    const body = `
      <p>Hi Amal, here is ACE's weekly report for <b>${esc(uaeTime(since).split(',')[0])} – ${esc(uaeTime(new Date(now).toISOString()).split(',')[0])}</b>.</p>
      <div style="padding:12px 14px;border-radius:8px;background:${healthGood ? '#E7F4EB' : '#FBF1DC'};font-weight:600">
        ${healthGood ? '✅ All good — no problems this week.' : `⚠️ ${problems.length} problem${problems.length === 1 ? '' : 's'} this week — details below.`}
      </div>

      ${section('Health', `
        ${ok(problems.length === 0, problems.length === 0 ? 'No errors' : `${problems.length} error${problems.length === 1 ? '' : 's'} (${byFp.size} different problem${byFp.size === 1 ? '' : 's'})`)}
        ${ok(remindersOk, remindersOk ? 'Meeting reminders running' : 'Meeting reminders NOT running')}
        ${ok(backupOk, `Nightly backups: ${weekBackups.length} of 7 nights saved${hb.backup?.info?.bytes ? ` (latest ${Math.round(hb.backup.info.bytes / 1024)} KB)` : ''}`)}
        ${ok(monitorOk, monitorOk ? 'Monitoring active' : 'Monitoring NOT running')}
        ${warnings.length ? `<div style="margin:4px 0">ℹ️ ${warnings.length} minor warning${warnings.length === 1 ? '' : 's'} (e.g. a notification couldn't reach a phone)</div>` : ''}
        ${topProblems.length ? `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:13px">
          <tr style="background:#F4F2F7"><th style="text-align:left;padding:6px">Problem</th><th style="padding:6px">Times</th><th style="text-align:left;padding:6px">Last</th></tr>
          ${topProblems.map((p) => `<tr><td style="padding:6px;border-top:1px solid #E8E1EF">${p.level === 'critical' ? '🔴 ' : ''}${esc(p.message)}${p.path ? `<br><span style="color:#7A6C86">${esc(p.path)}</span>` : ''}</td>
            <td style="padding:6px;border-top:1px solid #E8E1EF;text-align:center">${p.count}</td>
            <td style="padding:6px;border-top:1px solid #E8E1EF">${esc(uaeTime(p.last))}</td></tr>`).join('')}
        </table>` : ''}
      `)}

      ${section('This week in ACE', `
        <table style="width:100%;border-collapse:separate;border-spacing:6px"><tr>
          ${stat('New projects', newProjects.length)}
          ${stat('New quotations', (quotesNew || []).length)}
          ${stat('Meetings added', (meetingsNew || []).length)}
          ${stat('Active users', activeUsers ? activeUsers.length : '—')}
        </tr></table>
        ${newProjects.length ? `<div style="margin-top:8px"><b>New projects:</b> ${newProjects.slice(0, 15).map((p) => `${esc(p.name)} <span style="color:#7A6C86">(${esc(names[p.created_by] || '—')})</span>`).join(', ')}${newProjects.length > 15 ? '…' : ''}</div>` : ''}
        ${activeUsers?.length ? `<div style="margin-top:6px"><b>Signed in this week:</b> ${activeUsers.map(esc).join(', ')}</div>` : ''}
        <div style="margin-top:6px"><b>Meetings coming up in the next 7 days:</b> ${upcoming}</div>
        ${deleted.length ? `<div style="margin-top:6px"><b>Projects deleted:</b> ${deleted.map((d) => `${esc(d.message.replace('Project deleted: ', ''))} <span style="color:#7A6C86">(${esc(names[d.user_id] || 'unknown')})</span>`).join(', ')}</div>` : ''}
      `)}

      ${section('Projects by stage', statusCounts.length
        ? `<table style="width:100%;border-collapse:collapse;font-size:13px">${statusCounts.map((s, i) => `<tr><td style="padding:5px 6px;border-top:1px solid #E8E1EF">${esc(s.label)}</td><td style="padding:5px 6px;border-top:1px solid #E8E1EF;color:#7A6C86">${(PROJECT_STATUSES.findIndex((x) => x.value === s.value) + 1) * 10}%</td><td style="padding:5px 6px;border-top:1px solid #E8E1EF;text-align:right;font-weight:700">${s.n}</td></tr>`).join('')}</table>`
        : '<div>No projects yet.</div>')}

      ${section('Backup attached', `<div>This email carries this week's backup:<br>
        • <b>ACE-backup-${today}.xlsx</b>: open in Excel to read everything: Projects, Quotations, Contacts, Meetings, Expenses and Team<br>
        • <b>ACE-full-backup-${today}.json</b>: the restore file, for Claude to load back into ACE if data is ever lost (not meant for reading)<br>
        <span style="color:#7A6C86;font-size:13px">Keep these emails; each one is a restore point.</span></div>`)}
    `;

    const subject = `${healthGood ? '✅' : '⚠️'} ACE weekly report — ${problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}` : 'all good'}`;
    const sent = await sendEmail({ subject, html: emailShell('Weekly report', body), attachments });
    if (!sent.ok) throw new Error(sent.error);
    await heartbeat(admin, 'weekly-report', { problems: problems.length });
    return NextResponse.json({ ok: true, problems: problems.length, attachments: attachments.map((a) => a.filename) });
  } catch (e) {
    await logEvent(admin, { level: 'critical', source: 'weekly-report', message: `Weekly report failed: ${e.message}`, fingerprint: 'weekly-report-failed' });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) { return handle(req); }
export async function GET(req) { return handle(req); }
