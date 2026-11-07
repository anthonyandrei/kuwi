// Refresh the installed shell for the picker change; OPFS records are separate.
const CACHE = 'kuwi-storage-prototype-v2';
const ASSETS = ['/', '/index.html', '/app.js', '/db-worker.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/vendor/sqlite3.mjs', '/vendor/sqlite3.wasm'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('kuwi-storage-prototype-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(event.request)));
});
