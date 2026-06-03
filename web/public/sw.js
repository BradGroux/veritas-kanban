/* global caches, fetch, self, URL */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `veritas-kanban-static-${CACHE_VERSION}`;
const SHELL_URL = new URL('./', self.registration.scope).toString();
const PRECACHE_URLS = [
  SHELL_URL,
  new URL('manifest.webmanifest', self.registration.scope).toString(),
  new URL('favicon.svg', self.registration.scope).toString(),
  new URL('icons/pwa-icon.svg', self.registration.scope).toString(),
  new URL('icons/pwa-maskable-icon.svg', self.registration.scope).toString(),
];
const STATIC_DESTINATIONS = new Set(['font', 'image', 'manifest', 'script', 'style', 'worker']);

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isPrivateRoute(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  const scopedPath = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : url.pathname.replace(/^\//, '');
  return (
    scopedPath.startsWith('api/') ||
    scopedPath === 'api' ||
    scopedPath.startsWith('ws/') ||
    scopedPath === 'ws' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/ws/') ||
    url.pathname === '/ws'
  );
}

function isCacheableResponse(response) {
  const cacheControl = response.headers.get('cache-control') || '';
  return response.ok && !cacheControl.includes('no-store') && response.type !== 'opaqueredirect';
}

async function networkFirstShell(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(SHELL_URL);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== STATIC_CACHE).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || !isSameOrigin(url) || isPrivateRoute(url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(cacheFirstStatic(request));
  }
});
