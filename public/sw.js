// ACE service worker — receives background meeting reminders (even
// when ACE is closed), offers Stop / Snooze buttons, and tells ACE when
// a reminder was answered so the repeating notifications stop.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Who is signed in on this device (told to us by the ACE page)
const STATE_CACHE = 'ace-state';
const USER_KEY = '/__ace_signed_in_user';
let currentUser; // undefined = not loaded yet

async function getDeviceUser() {
  if (currentUser !== undefined) return currentUser;
  try {
    const cache = await caches.open(STATE_CACHE);
    const res = await cache.match(USER_KEY);
    currentUser = res ? (await res.json()).userId : null;
  } catch {
    currentUser = null;
  }
  return currentUser;
}

async function setDeviceUser(userId) {
  currentUser = userId || '';
  try {
    const cache = await caches.open(STATE_CACHE);
    await cache.put(USER_KEY, new Response(JSON.stringify({ userId: currentUser })));
  } catch { /* ignore */ }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ace-user') event.waitUntil(setDeviceUser(event.data.userId));
});

async function release(userId) {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/reminder-ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, userId, action: 'release' }),
    });
  } catch { /* ignore */ }
}

async function ack(meetingId, action) {
  if (!meetingId) return;
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/reminder-ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint, meetingId, action }),
    });
  } catch {
    /* offline — the repeats simply run their course */
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: '🔔 ACE reminder', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil((async () => {
    // Meant for a different person than the one signed in here (or
    // nobody is signed in)? Don't show it, and unregister this device
    // from that person.
    const deviceUser = await getDeviceUser();
    if (data.userId && deviceUser !== null && deviceUser !== data.userId) {
      await release(data.userId);
      return;
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = windows.find((w) => w.focused && w.visibilityState === 'visible');
    if (visible && data.tag !== 'ace-test') {
      // ACE is open on screen: its own ringing pop-up takes over
      windows.forEach((w) => w.postMessage({ type: 'ace-reminder', data }));
      return;
    }
    const options = {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'ace-reminder',
      renotify: true, // ring again on every repeat
      requireInteraction: true,
      silent: false,
      vibrate: [800, 300, 800, 300, 800, 300, 800],
      data: { url: data.url || '/planner', meetingId: data.meetingId || null },
    };
    if (data.meetingId && data.actions) {
      options.actions = [
        { action: 'stop', title: '🔕 Stop' },
        { action: 'snooze', title: 'Snooze 5 min' },
      ];
    }
    await self.registration.showNotification(data.title || '🔔 ACE reminder', options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const { url = '/planner', meetingId = null } = n.data || {};
  n.close();

  if (event.action === 'stop') { event.waitUntil(ack(meetingId, 'stop')); return; }
  if (event.action === 'snooze') { event.waitUntil(ack(meetingId, 'snooze')); return; }

  // tapped the notification itself: open ACE, where the reminder
  // pop-up is shown so it can be answered there
  event.waitUntil(Promise.all([
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) {
          if ('navigate' in w) w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  ]));
});

// swiped away / dismissed = "I've seen it"
self.addEventListener('notificationclose', (event) => {
  const { meetingId = null } = event.notification.data || {};
  event.waitUntil(ack(meetingId, 'stop'));
});
