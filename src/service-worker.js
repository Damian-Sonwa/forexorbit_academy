/* eslint-disable no-restricted-globals */
/**
 * ForexOrbit PWA — /service-worker.js (copied from src to public when Next config loads).
 * Bump CACHE_VERSION when precache list changes.
 *
 * Strategy: network-first for Next hashed assets (/_next/static/) so CSS/JS updates apply;
 * cache-first for other static file extensions as a fallback.
 */
const CACHE_VERSION = '2026-03-22-pwa-v2';
const STATIC_CACHE = `forexorbit-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `forexorbit-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      for (const url of PRECACHE_URLS) {
        try {
          await cache.add(new Request(url, { cache: 'reload' }));
        } catch (e) {
          console.warn('[ForexOrbit SW] precache skip:', url, e);
        }
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              k.startsWith('forexorbit-') &&
              k !== STATIC_CACHE &&
              k !== RUNTIME_CACHE
          )
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isStaticAsset(url) {
  const p = url.pathname;
  if (p.startsWith('/_next/static/')) return true;
  return /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(p);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isSameOrigin(url)) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  /** Next.js build assets: always try network first to avoid stale CSS/JS after deploy */
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const copy = res.clone();
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, copy);
          }
          return res;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          return new Response('Offline', { status: 503, statusText: 'Unavailable' });
        }
      })()
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const copy = res.clone();
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, copy);
          }
          return res;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match('/offline.html');
          if (offline) return offline;
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' },
          });
        }
      })()
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const updateCache = fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              return caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy)).then(() => res);
            }
            return res;
          })
          .catch(() => null);

        if (cached) {
          updateCache.catch(() => {});
          return cached;
        }
        const fresh = await updateCache;
        if (fresh) return fresh;
        return (
          (await caches.match(request)) ||
          new Response('Offline', { status: 503, statusText: 'Unavailable' })
        );
      })()
    );
    return;
  }
});
