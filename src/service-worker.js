/* eslint-disable no-restricted-globals */
/**
 * ForexOrbit PWA — /service-worker.js (copied from src to public when Next config loads).
 * Bump CACHE_VERSION when precache list changes.
 *
 * Strategy: network-first for Next hashed assets (/_next/static/) so CSS/JS updates apply;
 * cache-first for other static file extensions as a fallback.
 */
const CACHE_VERSION = '2026-10-28-pwa-v3';
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

// Phase 14: Web Push. The payload is minimal ({ id, title, url }) and encrypted end to end
// (RFC 8291); details are loaded from the app after the click, where access is checked again.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title.slice(0, 120) : 'ForexOrbit Academy';
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/notifications';
  event.waitUntil(self.registration.showNotification(title, {
    body: 'Open ForexOrbit to view it.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: typeof data.id === 'string' ? data.id : undefined,
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/notifications';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.navigate(url).catch(() => undefined);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
