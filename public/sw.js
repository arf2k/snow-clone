const CACHE_NAME = 'snow-chase-cache-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/src/app.js',
  '/src/config.js',
  '/src/nws.js',
  '/src/openmeteo.js',
  '/src/snotel.js',
  '/src/ui.js',
  '/src/windy.js',
  '/public/resorts.json',
  '/public/manifest.webmanifest',
  '/public/icons/icon-192.svg',
  '/public/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  const isStaticAsset =
    PRECACHE_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith('/src/') ||
    ['document', 'script', 'style', 'image', 'font'].includes(request.destination);

  if (isStaticAsset) {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}
