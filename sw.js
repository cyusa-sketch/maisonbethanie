/* Maison Béthanie service worker — offline support + auto-update */
const CACHE = 'mb-v2';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Let Supabase + CDN go straight to the network.
  if (url.origin !== location.origin) return;

  const isPage = e.request.mode === 'navigate' || e.request.destination === 'document'
    || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');

  if (isPage) {
    // Network-first so the app always updates when online; cache as offline fallback.
    e.respondWith(
      fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy));
        return resp;
      }).catch(() => caches.match('./index.html') || caches.match('./'))
    );
  } else {
    // Cache-first for static assets (icons, manifest).
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return resp;
        })
      )
    );
  }
});
