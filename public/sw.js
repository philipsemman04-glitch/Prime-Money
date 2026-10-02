// Service worker: shows phone notifications and opens the app when one is
// tapped. It does not cache anything, so updates always show straight away.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Team Prime', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/badge.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/#/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          return client.navigate(target).catch(() => client.postMessage({ type: 'open', url: target }));
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
