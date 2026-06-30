const CACHE = 'hartwell-clearance-v3-1-1';
const CORE = ['/', '/index.html', '/assets/styles.css', '/assets/app.js', '/data/bridges.json', '/data/settings.json', '/manifest.webmanifest', '/assets/icon.svg'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname.includes('/.netlify/functions/')) return;
  event.respondWith(fetch(event.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return res;
  }).catch(() => caches.match(event.request).then(res => res || caches.match('/index.html'))));
});
