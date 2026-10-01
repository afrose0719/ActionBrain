// ActionBrain service worker. Deliberately tiny.
//
// What it does: if a PAGE load fails because the device is offline, show a friendly offline page.
// What it never does: cache or touch API calls, scripts, or any user data. Nothing stale can ever be served,
// and nothing private is stored on the device by this file.

const CACHE = "actionbrain-offline-v2"; // bump this number whenever offline.html changes, so old copies are replaced
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Only page navigations. Everything else (API, assets, Supabase) goes straight to the network untouched.
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
