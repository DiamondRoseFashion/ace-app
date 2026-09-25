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
export async function sendToUser(admin, userId, payload) {
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);
  let delivered = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: 'high' }
      );
      delivered++;
      await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('id', s.id);
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
    }
  }
  return { devices: (subs || []).length, delivered };
}
