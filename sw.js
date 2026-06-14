/**
 * MediLine Service Worker
 * Cache strategy : Network First pour les assets dynamiques,
 * Cache First pour les assets statiques (fonts, icons)
 */

const CACHE_NAME = 'mediline-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// ── Installation : mettre en cache les assets statiques ──────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── Activation : nettoyer les anciens caches ──────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── Fetch : Network First avec fallback cache ─────────────────────
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Ne pas intercepter les requêtes Firebase, Stripe, Resend, fonts
  if (url.hostname !== location.hostname) return;

  // Ne pas intercepter les API routes
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then(function(response) {
        // Mettre à jour le cache si succès
        if (response.ok) {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, copy);
          });
        }
        return response;
      })
      .catch(function() {
        // Offline : servir depuis le cache
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/index.html');
        });
      })
  );
});
