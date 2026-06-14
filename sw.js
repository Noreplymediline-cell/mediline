/**
 * MediLine Service Worker
 * - Cache des assets statiques
 * - Réception des notifications push (Web Push)
 */

const CACHE_NAME = 'mediline-v2';
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE_NAME).then(function(cache) {
    return cache.addAll(STATIC_ASSETS).catch(function(){});
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k){ return k !== CACHE_NAME; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  if (url.hostname !== location.hostname) return;
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, copy); });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request).then(function(cached) {
        return cached || caches.match('/index.html');
      });
    })
  );
});

// ── Notifications push ─────────────────────────────────────────────
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}

  var title   = data.title   || 'MediLine';
  var body    = data.body    || "C'est bientôt votre tour !";
  var icon    = data.icon    || '/icon-192.png';
  var badge   = data.badge   || '/icon-192.png';
  var tag     = data.tag     || 'mediline-tour';
  var url     = data.url     || '/';

  e.waitUntil(
    self.registration.showNotification(title, {
      body    : body,
      icon    : icon,
      badge   : badge,
      tag     : tag,
      vibrate : [200, 100, 200],
      data    : { url: url }
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.includes(self.location.origin) && 'focus' in list[i]) {
          return list[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
