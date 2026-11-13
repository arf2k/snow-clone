// sw.js — offline support. Registered only in production builds (src/app.js).
//
// Strategy:
//   - page + data (/api/*, /resorts.json): network first, so you always get
//     fresh numbers when online; the last good copy is used when offline
//   - built assets (/assets/*, hashed filenames) and icons: cache first
// Only same-origin GET requests are touched. Nothing cross-origin is cached.

const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const DATA_CACHE = `data-${VERSION}`;
const MAX_DATA_ENTRIES = 120;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, DATA_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  // keys() is in insertion order, so the oldest entries go first
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k))
  );
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) {
      // Re-inserting moves the entry to the end, keeping trim() fair
      await cache.delete(request);
      await cache.put(request, res.clone());
      if (cacheName === DATA_CACHE) trim(cache, MAX_DATA_ENTRIES);
    }
    return res;
  } catch (err) {
    const cached =
      (await cache.match(request)) ||
      (fallbackUrl && (await cache.match(fallbackUrl)));
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE, '/'));
  } else if (url.pathname.startsWith('/api/') || url.pathname === '/resorts.json') {
    event.respondWith(networkFirst(request, DATA_CACHE));
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request));
  }
});
