const CACHE_NAME = "kairo-static-v4";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/app.css",
  "./js/main.js",
  "./js/store.js",
  "./js/ink.js",
  "./js/lines.js",
  "./js/layout.js",
  "./js/commit.js",
  "./js/pins.js",
  "./js/ai.js",
  "./js/render.js",
  "./js/tools.js",
  "./js/text.js",
  "./js/workspace.js",
  "./assets/demo-question.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
