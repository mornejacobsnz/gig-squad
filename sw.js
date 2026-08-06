// GIG SQUAD Service Worker v6
// ─── BUMP THIS NUMBER ON EVERY DEPLOY ───────────
const CACHE = 'gig-squad-v9';
// ────────────────────────────────────────────────

const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/gigamals/rumblix-removebg.png',
  '/assets/gigamals/lumis-removebg.png',
  '/assets/gigamals/fennick-removebg.png',
  '/assets/gigamals/zigby-removebg.png',
  '/assets/gigamals/prism-removebg.png',
  'https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700;800&display=swap'
];

// ── INSTALL — cache all assets ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(ASSETS.map(a => c.add(a).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE — delete all old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH strategy ──
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. Google Fonts — network first, cache fallback
  if (url.hostname.includes('fonts.googleapis') || url.hostname.includes('fonts.gstatic')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 2. HTML files — NETWORK FIRST so updates always land immediately
  if (e.request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 3. GigaMal images — network first so new images always load
  if (url.pathname.includes('/assets/gigamals/')) {
    e.respondWith(
      fetch(e.request).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 4. Everything else — cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(r => {
      if (r && r.status === 200 && r.type === 'basic') {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return r;
    }))
  );
});
