// Сохраняет приложение на устройстве, чтобы оно работало без интернета.
// При обновлении приложения увеличьте номер версии.
const VERSION = 'uni-v23';
const META = 'uni-meta';   // служебные данные приложения (дата пробного периода) — не удаляем при обновлении
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
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== META).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Страница и код приложения: сначала свежая версия с сайта (если есть интернет),
// иначе — сохранённая. Так обновления приходят сразу, а без интернета всё работает.
const FRESH = /\/(index\.html|app\.js|codes\.js|manifest\.webmanifest)?$/;

function networkFirst(req) {
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000));
  return Promise.race([fetch(req, { cache: 'no-cache' }), timeout]).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || caches.match('./index.html')));
}

function cacheFirst(req) {
  return caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }));
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/__meta/')) return;
  e.respondWith(e.request.mode === 'navigate' || FRESH.test(url.pathname) ? networkFirst(e.request) : cacheFirst(e.request));
});
