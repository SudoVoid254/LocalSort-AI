const CACHE_NAME = 'localsort-v2';
const ASSETS = [
  './',
  './index.html',
  './js/app.js',
  './js/fs-manager.js',
  './js/ui-handler.js',
  './js/ai-engine.js',
  './js/ai-worker.js',
  './js/config-store.js',
  './js/config-help.html',
  './css/styles.css',
  './manifest.json'
];

// Install: Cache core logic
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Fetch: Serve from cache, then network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});