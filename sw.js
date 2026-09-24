// CGExcel - Mots croisés - service worker
const CACHE = 'mc-cgexcel-v74';
const FICHIERS = ['./', './index.html', './moteur.js', './worker.js',
                  './lexique.txt', './manifest.webmanifest'];

// À l'installation on contourne le cache HTTP : sans cela le nouveau cache
// pouvait être rempli avec les anciens fichiers encore valides côté serveur.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    c.addAll(FICHIERS.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(cles =>
    Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Le lexique ne change jamais : cache d'abord. Tout le reste passe par le
// réseau quand il est disponible, le cache ne servant que hors ligne.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.endsWith('lexique.txt')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }
  e.respondWith(
    fetch(e.request).then(rep => {
      const copie = rep.clone();
      caches.open(CACHE).then(c => c.put(e.request, copie)).catch(() => {});
      return rep;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
