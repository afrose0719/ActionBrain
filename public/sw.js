// ActionBrain service worker. Deliberately small. It does two jobs.
//
// 1. If a PAGE load fails because the device is offline, show a friendly offline page.
// 2. Receive things shared to ActionBrain from the Android share sheet (see "share_target" in src/app/manifest.ts):
//      - text (from WhatsApp, Gmail...)  ->  opens the Inbox with the text filled in
//      - a call recording (audio file)   ->  held briefly in the browser's own storage, then opened in Meetings
//
// What it never does: cache or touch API calls, scripts, or any other user data. A shared recording stays on this device,
// is picked up by the page once (src/lib/shared-files.ts), and is deleted. Anything never picked up is deleted after a day.

const CACHE = "actionbrain-offline-v2"; // bump this number whenever offline.html changes, so old copies are replaced
const OFFLINE_URL = "/offline.html";
const SHARED_CACHE = "actionbrain-shared-v1"; // must match src/lib/shared-files.ts
const SHARE_PATH = "/share-target";
const SHARED_TTL_MS = 24 * 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // keep the current offline cache and the shared-files cache; delete every other (old) one
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== SHARED_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const go = (path) => Response.redirect(new URL(path, self.location.origin).href, 303);

async function forgetOldShares(cache) {
  for (const request of await cache.keys()) {
    const saved = Number((await cache.match(request))?.headers.get("x-saved-at"));
    if (!saved || Date.now() - saved > SHARED_TTL_MS) await cache.delete(request);
  }
}

async function receiveShare(request) {
  try {
    const form = await request.formData();

    const recording = form.getAll("audio").find((f) => typeof f === "object" && f && f.size > 0);
    if (recording) {
      const cache = await caches.open(SHARED_CACHE);
      await forgetOldShares(cache);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8).padEnd(4, "0")}`;
      await cache.put(
        new Request(new URL(`/__shared/${id}`, self.location.origin).href),
        new Response(recording, {
          headers: {
            "content-type": recording.type || "application/octet-stream",
            "x-file-name": encodeURIComponent(recording.name || "recording"),
            "x-saved-at": String(Date.now()),
          },
        })
      );
      return go(`/meetings?shared=${id}`);
    }

    // no file: it is shared text, which goes to the Inbox form
    const query = new URLSearchParams();
    for (const key of ["title", "text", "url"]) {
      const value = form.get(key);
      if (typeof value === "string" && value.trim()) query.set(key, value);
    }
    return go(query.toString() ? `/inbox?${query}` : "/inbox");
  } catch {
    return go("/inbox");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method === "POST" && new URL(request.url).pathname === SHARE_PATH) {
    event.respondWith(receiveShare(request));
    return;
  }

  // Otherwise only page navigations. Everything else (API, assets, Supabase) goes straight to the network untouched.
  if (request.mode !== "navigate") return;
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
});
