const CACHE_NAME = 'trace-shell-v10';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/app.css',
  './src/app.js',
  './icons/icon-source.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './fonts/lexend-400.woff2',
  './fonts/lexend-700.woff2',
  './licenses/Lexend-OFL.txt',
  './docs/README-KO.md',
  './docs/USER-GUIDE-KO.md',
  './docs/TEST-REPORT.md',
  './docs/GITHUB-PAGES-KO.md',
  '../shared/v1/sync.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        await cache.add(url);
      } catch (error) {
        // Each shell file is cached independently so one optional file cannot abort install.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('trace-shell-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === 'api.github.com') return;
  if (requestUrl.origin !== self.location.origin) return;

  const scopeUrl = new URL(self.registration.scope);
  const sharedModuleUrl = new URL('../shared/v1/sync.js', scopeUrl).href;
  const isTraceRequest = requestUrl.pathname.startsWith(scopeUrl.pathname);
  if (!isTraceRequest && requestUrl.href !== sharedModuleUrl) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (error) {
        return (await caches.match(request)) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const fresh = await fetch(request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (error) {
      return Response.error();
    }
  })());
});
