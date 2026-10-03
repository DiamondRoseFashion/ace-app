// ACE service worker — receives background meeting reminders (even
// when ACE is closed), offers Stop / Snooze buttons, and tells ACE when
// a reminder was answered so the repeating notifications stop.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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

  // tapped the notification itself: stop repeating and open the planner
  event.waitUntil(Promise.all([
    ack(meetingId, 'open'),
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
