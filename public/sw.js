// LearnSphere service worker: makes the app shell available offline.
// Course content (notes, questions, quizzes) lives in IndexedDB, not here. API calls are never cached.
const VERSION = "learnsphere-v2";
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL).catch(() => {});
    // Pre-cache the hashed JS/CSS the home page references, so the very first visit already works offline.
    try {
      const html = await (await fetch("/", { cache: "no-store" })).text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]);
      await Promise.all(assets.map(a => cache.add(a).catch(() => {})));
    } catch {}
    self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {   // network first, fall back to the cached app shell
    event.respondWith((async () => {
      try { const res = await fetch(req); (await caches.open(VERSION)).put("/", res.clone()); return res; }
      catch { return (await caches.match("/")) || Response.error(); }
    })());
    return;
  }
  event.respondWith((async () => {   // static files: cache first, refresh in the background
    const cached = await caches.match(req);
    const refresh = fetch(req).then(res => { if (res.ok) caches.open(VERSION).then(c => c.put(req, res.clone())); return res; }).catch(() => cached);
    return cached || refresh;
  })());
});
