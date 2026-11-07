// Сохраняет приложение на устройстве, чтобы оно работало без интернета.
// При обновлении приложения увеличьте номер версии.
const VERSION = 'uni-v18';
const FILES = [
  './', './index.html', './app.js', './codes.js', './manifest.webmanifest',
  './vendor/mediabunny.min.mjs', './vendor/mediabunny-aac-encoder.min.mjs',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/maskable-192.png', './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — берём свежие файлы с сайта, а не старые из кэша браузера
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Сначала из памяти устройства, если нет — из интернета
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
