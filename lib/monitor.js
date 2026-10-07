// ACE self-monitoring (server-only): records problems, keeps
// "heartbeats" for the scheduled jobs, and sends emails via Resend.
//
// Vercel settings used:
//   RESEND_API_KEY  – Resend API key (resend.com → API Keys)
//   ALERT_EMAIL     – where alerts + weekly reports go (comma-separate several)
//   ALERT_FROM      – optional sender, default "ACE Monitor <noreply@gemssystems.com>"

export const APP_URL = 'https://app.gemssystems.com';

function clip(v, n) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// Same problem → same fingerprint, so one bug = one alert, not hundreds
export function fingerprintOf(source, message, path) {
  const msg = String(message || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\d+/g, '#')
    .slice(0, 160);
  const p = String(path || '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/\?.*$/, '');
  return `${source}|${p}|${msg}`;
}

// level: 'critical' | 'error' | 'warning' | 'info'
export async function logEvent(admin, { level = 'error', source = 'server', message, detail = null, path = null, userId = null, fingerprint = null }) {
  try {
    await admin.from('app_events').insert({
      level,
      source,
      message: clip(message, 500) || '(no message)',
      detail: detail ? JSON.parse(JSON.stringify(detail, (k, v) => (typeof v === 'string' ? clip(v, 2000) : v))) : null,
      path: clip(path, 300),
      user_id: userId || null,
      fingerprint: fingerprint || fingerprintOf(source, message, path),
    });
  } catch {
    /* monitoring must never break the app */
  }
}

export async function heartbeat(admin, key, info = null) {
  try {
    await admin.from('app_heartbeats').upsert({ key, at: new Date().toISOString(), info });
  } catch { /* ignore */ }
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL);
}

// attachments: [{ filename, content: Buffer }]
export async function sendEmail({ subject, html, attachments = [] }) {
  if (!emailConfigured()) return { ok: false, error: 'RESEND_API_KEY / ALERT_EMAIL not set in Vercel' };
  const to = process.env.ALERT_EMAIL.split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.ALERT_FROM || 'ACE Monitor <noreply@gemssystems.com>',
        to,
        subject,
        html,
        attachments: attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') })),
      }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('x-cron-secret') || '';
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return header === secret || bearer === secret;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Dubai time, e.g. "06/10/2026, 2:15 PM"
export function uaeTime(iso) {
  const d = new Date(new Date(iso).getTime() + 4 * 3600 * 1000); // UAE = UTC+4, no daylight saving
  const p2 = (n) => String(n).padStart(2, '0');
  const h = d.getUTCHours();
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${h % 12 || 12}:${p2(d.getUTCMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Simple branded email wrapper
export function emailShell(title, bodyHtml, accent = '#0F1F3D') {
  return `<!doctype html><html><body style="margin:0;background:#F4F2F7;font-family:Segoe UI,Arial,sans-serif;color:#221429">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
  <div style="background:${accent};color:#fff;border-radius:12px 12px 0 0;padding:18px 22px">
    <div style="font-size:12px;letter-spacing:3px;color:#D8B968;font-weight:700">ACE MONITOR</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(title)}</div>
  </div>
  <div style="background:#fff;border-radius:0 0 12px 12px;padding:20px 22px;font-size:14px;line-height:1.55">${bodyHtml}
    <p style="margin-top:24px;font-size:12px;color:#7A6C86">Sent automatically by ACE · <a href="${APP_URL}" style="color:#6B2D82">${APP_URL.replace('https://', '')}</a></p>
  </div>
</div></body></html>`;
}
