// Service worker — tuned to AVOID stale installs during active development.
// Bumping CACHE forces a new SW to install, activate (skipWaiting), claim clients,
// and delete the old cache. Navigations are network-first so an online PWA always
// shows the latest deploy; cache is only an offline fallback.

const CACHE = "neurorvu-v3";
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon.svg"]; // minimal shell for installability

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => { if (e.data === "skip-waiting") self.skipWaiting(); });

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return; // never cache API / auth

  // Network-first for everything (always fresh online); fall back to cache offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((r) => r || (request.mode === "navigate" ? caches.match("/") : undefined))),
  );
});
