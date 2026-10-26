// Service worker: пази обвивката на приложението, за да се отваря като инсталирано приложение
// и да показва поне интерфейса без връзка. Данните (API, WebSocket) винаги идват от сървъра.
// Всичко минава първо през мрежата – така нов код се вижда веднага; кешът е само резерва.

const CACHE = 'shumomer-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      const cached = await caches.match(request) || (request.mode === 'navigate' && await caches.match('/'));
      if (cached) return cached;
      throw err;
    }
  })());
});
