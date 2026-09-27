// Typist service worker (generated at build time from this template).
//
// Precaches the application shell, fonts and bundled corpora. Installation
// fails as a whole if any asset cannot be cached, so the page never claims
// offline readiness it does not have. A new version waits; the page asks it
// to activate only between sessions, never during a timed block.
/* eslint-disable no-restricted-globals */
const BUILD = '__BUILD_ID__';
const PRECACHE = __PRECACHE_MANIFEST__;
const CACHE = `typist-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith('typist-') && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

async function status(client) {
  const cache = await caches.open(CACHE);
  const missing = [];
  for (const url of PRECACHE) if (!(await cache.match(url, { ignoreVary: true }))) missing.push(url);
  client?.postMessage({ type: 'status', version: BUILD, total: PRECACHE.length, missing });
}

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'skip-waiting') self.skipWaiting();
  if (type === 'check') event.waitUntil(status(event.source));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // The shell comes from the cache so the running version stays pinned.
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html', { ignoreVary: true })) || (await cache.match('./', { ignoreVary: true })) || fetch(request);
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Precached entries were fetched without the page's Origin header; a
      // server's "Vary: Origin" must not turn them into cache misses.
      const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      return hit || fetch(request);
    })(),
  );
});
