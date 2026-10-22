// Server-only helpers for sending push notifications.
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { VAPID_PUBLIC_KEY } from '@/lib/pushConfig';

export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function configurePush() {
  if (!process.env.VAPID_PRIVATE_KEY) {
    throw new Error('VAPID_PRIVATE_KEY is not set in Vercel');
  }
  webpush.setVapidDetails('mailto:noreply@gemssystems.com', VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

// Sends one payload to every device a user registered. Removes
// devices the push service says are gone (uninstalled / expired).
// Also saves it in the person's 🔔 inbox (except repeats of the same
// ringing reminder and test pushes), so it can be read later even
// without phone notifications turned on.
export async function saveToInbox(admin, userId, payload) {
  if (!userId || payload.repeat > 0 || payload.tag === 'ace-test' || payload.inbox === false) return;
  try {
    const { error } = await admin.from('notifications').insert({
      user_id: userId,
      kind: payload.kind || (payload.meetingId ? 'reminder' : 'info'),
      title: String(payload.title || 'ACE').slice(0, 300),
      body: payload.body ? String(payload.body).replace(/\nRepeats every minute until you tap Stop/, '').slice(0, 2000) : null,
      url: payload.url || null,
    });
    if (error) {
      await admin.from('app_events').insert({
        level: 'warning', source: 'inbox', message: `Couldn't save a notification to the bell: ${String(error.message).slice(0, 300)}`,
        user_id: userId, fingerprint: 'inbox-save-failed',
      });
    }
    if (!error && Math.random() < 0.05) {
      // tidy up now and then: keep 90 days
      await admin.from('notifications').delete().eq('user_id', userId)
        .lt('created_at', new Date(Date.now() - 90 * 86400000).toISOString());
    }
  } catch { /* inbox not set up yet: the push still goes out */ }
}

export async function sendToUser(admin, userId, payload) {
  await saveToInbox(admin, userId, payload);
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  let delivered = 0;
  const failures = [];
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...payload, userId }), // the device checks it's still this person's
        { TTL: 60 * 60, urgency: 'high' }
      );
      delivered++;
      await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', s.id);
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id); // device gone – normal
      } else {
        failures.push({ status: err?.statusCode || null, message: String(err?.body || err?.message || err).slice(0, 200) });
      }
    }
  }
  return { devices: (subs || []).length, delivered, failures };
}
