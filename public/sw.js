/*
 * Orbit service worker: makes the app open fast and work offline.
 * - Pages: network first, so a new version shows up as soon as you are online;
 *   the cached copy is used when offline, or when the network hasn't answered within
 *   a few seconds (a stalled Wi-Fi looks "online" but never answers).
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

const PAGE_TIMEOUT = 3000;

async function networkFirstPage(event) {
  const cache = await caches.open(PAGES);
  const fromNetwork = fetch(event.request).then(async (response) => {
    // Every route serves the same app shell, so keep one copy of it.
    if (response.ok) await cache.put(shell, response.clone());
    return response;
  });
  // Keep updating the saved copy in the background even if the saved one is shown first.
  event.waitUntil(fromNetwork.catch(() => undefined));
  const cached = await cache.match(shell);
  if (!cached) return fromNetwork.catch(() => Response.error());
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), PAGE_TIMEOUT));
  // A server error (GitHub Pages sometimes answers 500) also falls back to the saved copy.
  const winner = await Promise.race([fromNetwork.then((r) => (r.ok ? r : null)).catch(() => null), slow]);
  return winner ?? cached;
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
    event.respondWith(networkFirstPage(event));
    return;
  }
  const fonts = url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
  const staticFile = sameScope && /\/(assets|icons)\/|\.(?:js|css|png|svg|woff2?|webmanifest)$/.test(url.pathname);
  if (fonts || staticFile) event.respondWith(cacheFirst(request));
});
