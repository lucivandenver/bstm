const CACHE = "careerbridge-static-v4";
const ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/css/student.css",
  "/css/student-features.css",
  "/css/portal.css",
  "/css/admin.css",
  "/css/public-ui.css",
  "/css/public-content.css",
  "/css/landing.css",
  "/js/student.js",
  "/js/portal.js",
  "/js/pwa.js",
  "/js/signature.js",
  "/js/source-upload.js",
  "/js/course-job.js",
  "/js/faculty-generation.js",
  "/js/public-ui.js",
  "/js/auth.js",
  "/images/careerbridge_brand_logo.png",
  "/images/icons/airplane.svg",
  "/images/icons/airplane-3d-192.png",
  "/images/icons/airplane-3d-512.png",
  "/images/icons/airplane-3d-maskable-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("careerbridge-static-") && key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== self.location.origin
  )
    return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
    );
    return;
  }
  if (ASSETS.includes(url.pathname))
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
});
