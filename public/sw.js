/* i12farm service worker
 * - App shell + static assets: cache-first (they are content-hashed).
 * - Pages: network-first, falling back to the last cached copy, then /offline.
 * - Farm photos: cache-first with a small cap, so recently seen farms work offline.
 * - API and auth calls are never cached.
 * Bump VERSION to force every phone to drop old caches.
 */
const VERSION = 'v3';
const SHELL = `i12f-shell-${VERSION}`;
const PAGES = `i12f-pages-${VERSION}`;
const MEDIA = `i12f-media-${VERSION}`;
const PRECACHE = ['/offline', '/manifest.webmanifest', '/icons/icon-192.png'];
const MAX_PAGES = 30;
const MAX_MEDIA = 80;
// Personal pages are never stored: field agents often share one phone.
const PRIVATE = ['/my-farm', '/inbox', '/sign-in', '/account', '/orders', '/admin', '/checkout', '/vets', '/partner', '/auth'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('i12f-') && !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName, max) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
    if (max) trim(cacheName, max);
  }
  return response;
}

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PAGES);
      cache.put(request, response.clone());
      trim(PAGES, MAX_PAGES);
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('/offline'));
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Farm photos: /media/farms/... on our own server, or the same path on the
  // public bucket (e.g. Cloudflare R2) when NEXT_PUBLIC_MEDIA_URL points there.
  if (url.pathname.startsWith('/media/farms/') || url.pathname.startsWith('/farms/')) {
    event.respondWith(cacheFirst(request, MEDIA, MAX_MEDIA));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }

  if (request.mode === 'navigate') {
    if (PRIVATE.some((p) => url.pathname.startsWith(p))) return;
    event.respondWith(networkFirstPage(request));
  }
});
