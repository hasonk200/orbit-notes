/*
 * Orbit service worker: makes the app open fast and work offline.
 * - Pages: network first, so a new version shows up as soon as you are online;
 *   the cached copy is used when offline.
 * - Built files (hashed names), icons and fonts: cache first, since they never change.
 * Only GET requests to this site and Google Fonts are handled. Firebase, Google
 * sign-in and the Orbit API always go straight to the network.
 */
const VERSION = 'v1';
const PAGES = `orbit-pages-${VERSION}`;
const ASSETS = `orbit-assets-${VERSION}`;
const MAX_ASSETS = 150;
const scope = new URL(self.registration.scope);
const shell = new URL('./', scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.add(shell)).catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([PAGES, ASSETS]);
    for (const key of await caches.keys()) if (key.startsWith('orbit-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    // Every route serves the same app shell, so keep one copy of it.
    if (response.ok) await cache.put(shell, response.clone());
    return response;
  } catch {
    return (await cache.match(shell)) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    await cache.put(request, response.clone());
    void trim(cache);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameScope = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  if (request.mode === 'navigate' && sameScope) {
    event.respondWith(networkFirstPage(request));
    return;
  }
  const fonts = url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
  const staticFile = sameScope && /\/(assets|icons)\/|\.(?:js|css|png|svg|woff2?|webmanifest)$/.test(url.pathname);
  if (fonts || staticFile) event.respondWith(cacheFirst(request));
});
