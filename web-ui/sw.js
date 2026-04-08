// W-50: Dante Patchbox Service Worker
// Provides offline capability for the web UI assets

const CACHE_NAME = 'patchbox-v1';
const STATIC_ASSETS = [
  '/',
  '/app.js',
  '/style.css',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept WebSocket or API calls — only serve cached UI assets
  if (url.pathname.startsWith('/api') || url.pathname === '/ws') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful HTML/JS/CSS responses
        if (response.ok && ['/', '/app.js', '/style.css', '/manifest.json'].includes(url.pathname)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
