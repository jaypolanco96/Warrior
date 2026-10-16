// Warrior's offline helper. It lets the installed app open without a connection and shows notifications.
// It never stores or changes anything from /api (prices, quotes, trades are always live or absent, never stale),
// and it always prefers the network, so a new version of the site replaces the saved one on the next visit.
const CACHE = 'warrior-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => { for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name); await self.clients.claim(); })()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/scorecard.json') return;
  event.respondWith((async () => {
    try { const fresh = await fetch(event.request); if (fresh.ok) { const copy = fresh.clone(); event.waitUntil(caches.open(CACHE).then((c) => c.put(event.request, copy))); } return fresh; }
    catch { const saved = await caches.match(event.request, { ignoreSearch: url.pathname === '/' }); if (saved) return saved; throw new Error('offline'); }
  })());
});
self.addEventListener('notificationclick', (event) => { event.notification.close(); event.waitUntil((async () => { const open = await self.clients.matchAll({ type: 'window' }); if (open.length) return open[0].focus(); return self.clients.openWindow('/'); })()); });
