/**
 * CDS Mobile RC2.4.9 — Service Worker
 * Cache de assets estáticos. Nunca intercepta /api/*.
 * HTML/JS/ícones/manifest: network-first (evita ícone/atalho stale).
 */
const CACHE = 'cds-mobile-2.5.6-resumo';
const PRECACHE = [
  '/apps/mobile/manifest.webmanifest',
  '/apps/mobile/icons/favicon-32.png',
  '/apps/mobile/icons/icon-192.png',
  '/apps/mobile/icons/icon-512.png',
  '/apps/mobile/icons/icon-512-maskable.png',
  '/apps/mobile/icons/apple-touch-icon.png',
  '/shared/design-system/index.css',
  '/shared/img/logo-cds-sistemas.png'
];

function isNetworkFirstAsset(url) {
  const p = url.pathname;
  return (
    p === '/apps/mobile/' ||
    p === '/apps/mobile/index.html' ||
    p.endsWith('.css') ||
    p.endsWith('.webmanifest') ||
    p.endsWith('.png') ||
    p.endsWith('.ico') ||
    p.indexOf('/apps/mobile/js/') === 0 ||
    p.indexOf('/apps/mobile/icons/') === 0
  );
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE).catch(function () {
        /* precache parcial aceitável */
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
          return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.pathname.indexOf('/api/') === 0) return;
  if (/\.m?js$/i.test(url.pathname) || url.pathname.indexOf('/apps/mobile/js/') === 0) {
    return;
  }

  if (url.pathname.indexOf('/apps/mobile') !== 0 &&
      url.pathname.indexOf('/shared/') !== 0) {
    return;
  }

  if (isNetworkFirstAsset(url)) {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      }).catch(function () {
        return caches.match(req);
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      const network = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      }).catch(function () {
        return cached || Response.error();
      });
      return cached || network;
    })
  );
});
