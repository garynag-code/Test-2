/* Worship Team Roster — service worker for offline use on Android/phones.
 * Cache-first for the app shell so it launches with no network; bump CACHE
 * when any shell file changes to roll the cache over. */

const CACHE = 'worship-roster-v19';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/config.js',
  './js/api.js',
  './js/app.js',
  './img/logo.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Same-origin app files: NETWORK-FIRST so the app always self-updates when
  // online (fresh HTML/JS/CSS every load), falling back to cache only offline.
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Cross-origin (e.g. chord lookups): network-first, fall back to cache.
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

/* ---- Web Push (cloud mode) --------------------------------------------------
 * The server sends a payload-less "tickle" (so no message content is ever
 * transmitted or needs decrypting). We show a prompt to open the app, where the
 * Reminders tab lists exactly what's due. */
self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Worship Team Roster', {
      body: 'You have reminders due today — tap to open your roster.',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'worship-reminders',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
