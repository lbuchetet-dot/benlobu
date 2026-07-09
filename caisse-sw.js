// ══════════════════════════════════════════════════════════
// Service worker CAISSE Pok&Ben / Capt&Fish — mode hors-ligne
// Met en cache l'application et ses dépendances : la caisse
// démarre et fonctionne même sans réseau (les données passent
// par la file locale et se synchronisent à la reconnexion).
// ══════════════════════════════════════════════════════════
const CACHE = 'pokben-caisse-v1';

const ASSETS = [
  './caisse.html',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-check-compat.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  // Ne JAMAIS intercepter le temps réel Firebase ni l'authentification
  if (url.includes('firebasedatabase.app') || url.includes('firebaseio.com') ||
      url.includes('identitytoolkit') || url.includes('securetoken') ||
      url.includes('firebaseappcheck')) return;

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      // Réseau d'abord pour la page elle-même (mises à jour), cache en secours
      const fetchPromise = fetch(e.request).then(res => {
        if (res && res.ok && (url.startsWith(self.location.origin) || url.includes('gstatic.com'))) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached || caches.match('./caisse.html'));
      // Cache d'abord pour les libs (rapidité), réseau d'abord pour le HTML
      if (url.includes('gstatic.com')) return cached || fetchPromise;
      return fetchPromise;
    })
  );
});
