/* Familiebudget – offline-cache. Ret VERSION når filerne opdateres. */
const VERSION = 'familiebudget-v26';
const ASSETS = ['./', 'index.html', 'standalone.js', 'exceljs.min.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // GitHub-synk m.m. går altid direkte på nettet
  if (/sw\.js$/.test(url.pathname) || url.search) return; // versionstjek og forespørgsler med parametre caches ikke
  const big = /exceljs|\.png$/.test(url.pathname);
  if (big){ e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const cp = res.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return res; }))); return; }
  // App-filer: hent nyeste version, brug cachen hvis offline
  e.respondWith(fetch(req.mode === 'navigate' ? url.href.split('#')[0] : req, { cache: 'no-cache' }).then(res => { if (res.ok){ const cp = res.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return res; })
    .catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});

/* Månedlig påmindelse (Chrome/Edge på Android og PC, når appen er installeret) */
const MON = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
self.addEventListener('periodicsync', e => {
  if (e.tag !== 'familiebudget-maaned') return;
  e.waitUntil((async () => {
    const d = new Date(); if (d.getDate() < 3 || d.getDate() > 10) return;
    const key = d.getFullYear() + '-' + d.getMonth(), c = await caches.open('familiebudget-meta'), seen = await c.match('/__notified');
    if (seen && (await seen.text()) === key) return;
    await c.put('/__notified', new Response(key));
    const prev = MON[(d.getMonth() + 11) % 12];
    await self.registration.showNotification('Familiebudget', { body: `Husk at afstemme ${prev} – importér kontoudtoget under Afstem.`, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'familiebudget-maaned', data: { url: './#afstem' } });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { for (const c of cs){ if ('focus' in c){ c.navigate(url).catch(() => {}); return c.focus(); } } return self.clients.openWindow(url); }));
});
