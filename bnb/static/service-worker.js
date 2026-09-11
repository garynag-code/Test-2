/* Offline support.
 *
 * A guesthouse on intermittent rural mobile data must still be able to look up
 * who is arriving and check them in.  The shell is cached on install so the app
 * opens with no signal at all; API reads use network-first with a cache
 * fallback, so the owner sees live data when there is a connection and the last
 * known state when there is not.
 *
 * Writes are never cached or replayed here — they go through the app's own
 * queue (js/queue.js), which carries the idempotency key that makes a replay
 * safe.  A service worker retrying a POST on its own has no way to know whether
 * the first attempt reached the server, which is exactly how an offline queue
 * creates the double booking it was meant to prevent.
 */

const VERSION = 'perch-v1';
const SHELL = [
  '/',
  '/static/css/styles.css',
  '/static/js/app.js',
  '/static/js/api.js',
  '/static/js/grid.js',
  '/static/js/format.js',
  '/static/js/queue.js',
  '/static/icons/icon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll is all-or-nothing, so one 404 would leave the app with no
      // offline shell at all.  Each file is allowed to fail on its own.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;          // writes belong to the queue

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/ical/')) return; // always live for the platforms

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Refresh in the background so the next open is current, without making
    // this one wait for the network.
    refreshInBackground(request);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const shell = await caches.match('/');
    if (shell && request.mode === 'navigate') return shell;
    return new Response('offline', { status: 503 });
  }
}

function refreshInBackground(request) {
  fetch(request)
    .then(async (response) => {
      if (!response.ok) return;
      const cache = await caches.open(VERSION);
      cache.put(request, response);
    })
    .catch(() => { /* still offline; the cached copy stands */ });
}
