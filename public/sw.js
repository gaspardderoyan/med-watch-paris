const CACHE = "dose-tracker-v1";
const ASSETS = [
  "/",
  "/index.html", 
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  
  // Only handle GET requests for our domain
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) {
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      
      return fetch(req).then((response) => {
        // Cache successful responses for app shell/static files
        if (response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return response;
      }).catch(() => {
        // Fallback to cached index for navigation requests when offline
        if (req.mode === 'navigate') {
          return caches.match('/');
        }
        throw new Error('No cached content available');
      });
    })
  );
});