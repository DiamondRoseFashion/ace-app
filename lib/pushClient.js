// Browser-side: register this phone/computer for background meeting
// reminders, and keep the registration fresh.
import { VAPID_PUBLIC_KEY } from '@/lib/pushConfig';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function isIos() {
  return typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone() {
  return typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function save(supabase, sub) {
  const json = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw new Error(error.message);
}

// Returns 'on' | 'denied' | 'unsupported' | 'needs-home-screen'
export async function enablePush(supabase) {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await save(supabase, sub);
  return 'on';
}

export async function disablePush(supabase) {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}

export async function pushStatus() {
  if (!pushSupported()) return isIos() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

// Tell the service worker who is signed in on this device, so a
// reminder meant for someone else is never shown here.
export async function setDeviceUser(userId) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sw = reg?.active || navigator.serviceWorker.controller;
    sw?.postMessage({ type: 'ace-user', userId: userId || null });
  } catch { /* ignore */ }
}

// Called quietly on each app load (and whenever a different person
// signs in): if this device already allowed notifications, make sure
// it's registered to whoever is signed in — and only to them.
let syncedFor = null;
export async function syncPush(supabase, userId) {
  if (userId) await setDeviceUser(userId);
  if (!pushSupported() || Notification.permission !== 'granted') return;
  if (userId && syncedFor === userId) return;
  syncedFor = userId || 'unknown';
  try {
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await save(supabase, sub);
  } catch {
    syncedFor = null;
  }
}

// On sign-out: stop this device receiving the signed-out person's
// reminders. The browser keeps its registration so the next person to
// sign in is registered instantly.
export async function releasePush(supabase) {
  syncedFor = null;
  await setDeviceUser(null);
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  } catch { /* ignore */ }
}
