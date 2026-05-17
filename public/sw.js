// Service Worker for Web Push Notifications + cache management

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
const IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

self.addEventListener('install', (event) => {
  // Activate immediately, don't wait for old SW to release clients
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Delete every cache that isn't part of the current version
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n !== STATIC_CACHE && n !== IMAGE_CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

const isHtmlRequest = (request) =>
  request.mode === 'navigate' ||
  (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));

const isStaticAsset = (url) =>
  /\.(?:js|mjs|css|woff2?|ttf|otf)$/i.test(url.pathname) || url.pathname.startsWith('/assets/');

const isImageAsset = (url, request) =>
  request.destination === 'image' || /\.(?:png|jpe?g|gif|webp|svg|ico|avif)$/i.test(url.pathname);

// Network-first for HTML: always try network, fall back to cache offline
async function networkFirstHtml(request) {
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    return fresh;
  } catch (e) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw e;
  }
}

// Stale-while-revalidate for JS/CSS/fonts
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await networkPromise) || fetch(request);
}

// Cache-first for images, expire after 24h
async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    const dateHeader = cached.headers.get('sw-cached-at');
    const cachedAt = dateHeader ? Number(dateHeader) : 0;
    if (cachedAt && Date.now() - cachedAt < IMAGE_MAX_AGE_MS) return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Wrap response to attach a timestamp header
      const cloned = response.clone();
      const body = await cloned.blob();
      const headers = new Headers(cloned.headers);
      headers.set('sw-cached-at', String(Date.now()));
      const stamped = new Response(body, {
        status: cloned.status,
        statusText: cloned.statusText,
        headers,
      });
      cache.put(request, stamped);
    }
    return response;
  } catch (e) {
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache cross-origin / API calls (Supabase, etc.)
  if (url.origin !== self.location.origin) return;

  // Never cache the SW itself or the manifest
  if (url.pathname === '/sw.js' || url.pathname === '/manifest.json') return;

  if (isHtmlRequest(request)) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isImageAsset(url, request)) {
    event.respondWith(cacheFirstImage(request));
    return;
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'お知らせ', body: '新しい通知があります', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'default',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
