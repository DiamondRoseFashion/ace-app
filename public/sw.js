// ACE service worker — receives background meeting reminders (even
// when ACE is closed) and opens the planner when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
    await self.registration.showNotification(data.title || '🔔 ACE reminder', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'ace-reminder',
      renotify: true,
      requireInteraction: true,
      vibrate: [600, 250, 600, 250, 600, 250, 600],
      data: { url: data.url || '/planner' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/planner';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w) {
          if ('navigate' in w) w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
