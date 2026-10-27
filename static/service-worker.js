/* Network-only PWA shell: never cache private pages, API responses, or approvals. */
self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Preserve normal Cloudflare Access and Worker behavior; no offline data or queue.
  event.respondWith(fetch(request));
});
