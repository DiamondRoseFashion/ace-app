// Every 5 minutes: checks ACE's health and emails an instant alert
// when something goes wrong —
//   • errors people hit (crashes, failed saves/loads, server errors)
//   • reminders job stopped running
//   • nightly backup missing or failed
//   • several projects deleted within an hour (possible data loss)
// The same problem is emailed at most every few hours, never spammed.
import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/pushServer';
import {
  cronAuthorized, logEvent, heartbeat, sendEmail, emailConfigured, esc, uaeTime, emailShell, APP_URL,
} from '@/lib/monitor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const REMINDERS_STALE = 10 * MIN; // reminders job runs every minute
const BACKUP_STALE = 26 * HOUR; // backup runs nightly
const DELETE_BURST = 3; // projects deleted within an hour
const REPEAT_AFTER = { critical: 1 * HOUR, error: 6 * HOUR }; // re-alert same problem after
const LOOK_BACK = 24 * HOUR;

async function recentlyLogged(admin, fingerprint, withinMs) {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { count } = await admin.from('app_events').select('id', { count: 'exact', head: true })
    .eq('fingerprint', fingerprint).gte('created_at', since);
  return (count || 0) > 0;
}

async function checkHeartbeats(admin, now) {
  const { data } = await admin.from('app_heartbeats').select('*');
  const hb = Object.fromEntries((data || []).map((r) => [r.key, Date.parse(r.at)]));
  if (hb.reminders && now - hb.reminders > REMINDERS_STALE && !(await recentlyLogged(admin, 'hb-reminders', HOUR))) {
    await logEvent(admin, {
      level: 'critical', source: 'monitor', fingerprint: 'hb-reminders',
      message: `Meeting reminders have stopped — last run ${Math.round((now - hb.reminders) / MIN)} minutes ago`,
      detail: { last_run: new Date(hb.reminders).toISOString() },
    });
  }
  if (hb.backup && now - hb.backup > BACKUP_STALE && !(await recentlyLogged(admin, 'hb-backup', 12 * HOUR))) {
    await logEvent(admin, {
      level: 'critical', source: 'monitor', fingerprint: 'hb-backup',
      message: `Nightly backup hasn't run for ${Math.round((now - hb.backup) / HOUR)} hours`,
      detail: { last_run: new Date(hb.backup).toISOString() },
    });
  }
}

async function checkDeletions(admin, now) {
  const since = new Date(now - HOUR).toISOString();
  const { data } = await admin.from('app_events').select('message, user_id, created_at')
    .eq('fingerprint', 'project-deleted').gte('created_at', since);
  if ((data || []).length >= DELETE_BURST && !(await recentlyLogged(admin, 'delete-burst', HOUR))) {
    await logEvent(admin, {
      level: 'critical', source: 'monitor', fingerprint: 'delete-burst',
      message: `${data.length} projects were deleted in the last hour — please check this was intended`,
      detail: { deleted: data.map((d) => ({ what: d.message.replace('Project deleted: ', ''), by: d.user_id, at: d.created_at })) },
    });
  }
}

function groupEvents(events) {
  const groups = new Map();
  for (const e of events) {
    const g = groups.get(e.fingerprint) || { ...e, count: 0, users: new Set(), first: e.created_at, last: e.created_at, ids: [] };
    g.count += 1;
    g.ids.push(e.id);
    if (e.user_id) g.users.add(e.user_id);
    if (e.created_at < g.first) g.first = e.created_at;
    if (e.created_at > g.last) { g.last = e.created_at; g.message = e.message; g.detail = e.detail; g.path = e.path; }
    if (e.level === 'critical') g.level = 'critical';
    groups.set(e.fingerprint, g);
  }
  return [...groups.values()].sort((a, b) => (a.level === 'critical' ? -1 : 0) - (b.level === 'critical' ? -1 : 0) || b.count - a.count);
}

function explain(g) {
  if (g.source === 'browser:database') return 'A database save or load failed for someone using ACE.';
  if (g.source === 'browser:api') return 'An ACE server function failed while someone was using it.';
  if (g.source?.startsWith('browser:')) return 'A page crashed or misbehaved in someone\'s browser.';
  if (g.source === 'reminders') return 'Problem with meeting reminders.';
  if (g.source === 'backup') return 'Problem with the nightly backup.';
  return '';
}

function alertHtml(groups, names) {
  const rows = groups.map((g) => {
    const who = [...g.users].map((u) => names[u] || 'a team member').join(', ');
    const detail = g.detail?.deleted
      ? `<ul style="margin:6px 0 0;padding-left:18px">${g.detail.deleted.map((d) => `<li>${esc(d.what)} — by ${esc(names[d.by] || 'unknown')} at ${esc(uaeTime(d.at))}</li>`).join('')}</ul>`
      : '';
    const color = g.level === 'critical' ? '#B33A3A' : '#9A7213';
    return `<div style="border:1px solid #E8E1EF;border-left:4px solid ${color};border-radius:8px;padding:12px 14px;margin:12px 0">
      <div style="font-weight:700;color:${color};font-size:12px;letter-spacing:1px">${g.level === 'critical' ? 'CRITICAL' : 'ERROR'}${g.count > 1 ? ` · happened ${g.count}×` : ''}</div>
      <div style="font-weight:600;margin:4px 0">${esc(g.message)}</div>
      <div style="color:#7A6C86;font-size:13px">${esc(explain(g))}
        ${g.path ? `<br>Page: <b>${esc(g.path)}</b>` : ''}
        ${g.detail?.endpoint ? `<br>Where: ${esc(g.detail.endpoint)}${g.detail.status ? ` (${esc(g.detail.status)})` : ''}` : ''}
        ${who ? `<br>Affected: ${esc(who)}` : ''}
        <br>When: ${esc(uaeTime(g.last))}</div>${detail}
    </div>`;
  }).join('');
  return emailShell(
    groups.some((g) => g.level === 'critical') ? 'Something needs attention now' : 'ACE noticed a problem',
    `<p>Hi Amal, ACE detected the following. Forward this email to Claude (or paste it into your chat) and it will be investigated and fixed.</p>${rows}
     <p style="font-size:13px;color:#7A6C86">The same problem won't be emailed again for a few hours unless it gets worse. You'll also see it in Monday's weekly report.</p>`,
    groups.some((g) => g.level === 'critical') ? '#7A1F1F' : '#0F1F3D'
  );
}

async function handle(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = adminClient();
  const now = Date.now();

  try {
    await checkHeartbeats(admin, now);
    await checkDeletions(admin, now);

    // problems not yet alerted
    const { data: pending, error } = await admin.from('app_events')
      .select('*').is('alerted_at', null).in('level', ['critical', 'error'])
      .gte('created_at', new Date(now - LOOK_BACK).toISOString())
      .order('created_at', { ascending: true }).limit(500);
    if (error) throw new Error(error.message);

    const groups = groupEvents(pending || []);
    const toSend = [];
    const suppressedIds = [];
    for (const g of groups) {
      const repeatAfter = REPEAT_AFTER[g.level] || REPEAT_AFTER.error;
      const since = new Date(now - repeatAfter).toISOString();
      const { count } = await admin.from('app_events').select('id', { count: 'exact', head: true })
        .eq('fingerprint', g.fingerprint).not('alerted_at', 'is', null).gte('alerted_at', since);
      if ((count || 0) > 0) suppressedIds.push(...g.ids); // already told recently
      else toSend.push(g);
    }

    const stamp = new Date(now).toISOString();
    if (suppressedIds.length) await admin.from('app_events').update({ alerted_at: stamp }).in('id', suppressedIds);

    let email = null;
    if (toSend.length && emailConfigured()) {
      const userIds = [...new Set(toSend.flatMap((g) => [...g.users, ...((g.detail?.deleted || []).map((d) => d.by))]).filter(Boolean))];
      const names = {};
      if (userIds.length) {
        const { data: profs } = await admin.from('profiles').select('id, full_name').in('id', userIds);
        (profs || []).forEach((p) => { names[p.id] = p.full_name; });
      }
      const critical = toSend.some((g) => g.level === 'critical');
      const subject = critical
        ? `🔴 ACE critical: ${toSend.find((g) => g.level === 'critical').message.slice(0, 80)}`
        : `⚠️ ACE alert: ${toSend.length === 1 ? toSend[0].message.slice(0, 80) : `${toSend.length} problems detected`}`;
      email = await sendEmail({ subject, html: alertHtml(toSend.slice(0, 20), names) });
      if (email.ok) {
        await admin.from('app_events').update({ alerted_at: stamp }).in('id', toSend.flatMap((g) => g.ids));
      }
    }

    await heartbeat(admin, 'monitor', { pending: (pending || []).length, alerted: email?.ok ? toSend.length : 0 });
    return NextResponse.json({
      ok: true, problems: toSend.length, suppressed: suppressedIds.length,
      email: email ? (email.ok ? 'sent' : email.error) : (toSend.length ? 'email not configured' : 'nothing to send'),
      app: APP_URL,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) { return handle(req); }
export async function GET(req) { return handle(req); }
