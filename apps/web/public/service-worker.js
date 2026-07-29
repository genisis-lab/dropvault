const CACHE = "dropvault-shell-v5";
const SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/theme-bootstrap.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/"))
    return;
  // Hashed build assets are immutable and already cached by the browser/CDN.
  // Do not put them in Cache Storage: during a deployment edge propagation can
  // briefly return the SPA HTML fallback for a new asset path, and caching that
  // response would make the app fail with a JavaScript MIME-type error.
  if (url.pathname.startsWith("/assets/")) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            response.ok &&
            response.headers.get("content-type")?.includes("text/html")
          ) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE).then((cache) => cache.put("/", copy)),
            );
          }
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  if (!SHELL.includes(url.pathname)) return;
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        }),
    ),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "dropvault-resume-uploads") return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) =>
        clients.forEach((client) =>
          client.postMessage({ type: "DROPVAULT_RESUME_UPLOADS" }),
        ),
      ),
  );
});
