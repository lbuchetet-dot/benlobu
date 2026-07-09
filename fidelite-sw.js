// ══════════════════════════════════════════════════════════
// Service worker TABLETTE FIDÉLITÉ Pok&Ben — mode hors-ligne
// ══════════════════════════════════════════════════════════
const CACHE = 'pokben-fidelite-v1';

const ASSETS = [
  './pokeben-fidelite.html',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a)))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.includes('firebasedatabase.app') || url.includes('firebaseio.com') ||
      url.includes('identitytoolkit') || url.includes('securetoken')) return;

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.ok && (url.startsWith(self.location.origin) || url.includes('gstatic.com'))) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached || caches.match('./pokeben-fidelite.html'));
      if (url.includes('gstatic.com')) return cached || fetchPromise;
      return fetchPromise;
    })
  );
});
