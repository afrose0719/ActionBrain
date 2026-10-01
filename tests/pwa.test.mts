import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";
import manifest from "../src/app/manifest.ts";
import { safeNextPath, sharedTextFrom } from "../src/lib/navigation.ts";

const m = manifest();

// ---------------- manifest: make sure it does not promise things that do not exist ----------------

const pageExists = (route: string) => {
  const name = route.replace(/^\//, "").split("?")[0];
  return ["src/app/(app)", "src/app"].some((dir) => existsSync(`${dir}/${name}/page.tsx`));
};

/** Reads width and height from a PNG file's header. */
function pngSize(path: string) {
  const b = readFileSync(path);
  assert.equal(b.subarray(1, 4).toString(), "PNG", `${path} is not a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

test("manifest has what browsers require to offer installation", () => {
  assert.ok(m.name && m.short_name);
  assert.equal(m.display, "standalone");
  assert.ok(m.theme_color && m.background_color);
  assert.ok(pageExists(m.start_url!), `start_url ${m.start_url} must be a real page`);
});

test("every icon file exists and is exactly the size the manifest claims", () => {
  assert.ok(m.icons!.length >= 3);
  for (const icon of m.icons!) {
    const file = `public${icon.src}`;
    assert.ok(existsSync(file), `${icon.src} is missing`);
    assert.equal(pngSize(file), icon.sizes, icon.src);
  }
});

test("there is a 192px and 512px icon, and a maskable one for Android", () => {
  const sizes = m.icons!.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(m.icons!.some((i) => i.purpose === "maskable"));
});

test("the Apple home-screen icon exists and is 180x180", () => {
  assert.equal(pngSize("public/icons/apple-touch-icon.png"), "180x180");
});

test("every shortcut points to a real page", () => {
  assert.ok(m.shortcuts!.length > 0);
  for (const s of m.shortcuts!) assert.ok(pageExists(s.url), `shortcut ${s.url} has no page`);
});

test("share target points to the Inbox and reads title/text/url", () => {
  const t = m.share_target!;
  assert.ok(pageExists(t.action));
  assert.equal(String(t.method).toUpperCase(), "GET");
  assert.deepEqual(t.params, { title: "title", text: "text", url: "url" });
});

// ---------------- service worker: run the real file against a fake browser ----------------

function loadServiceWorker(opts: { online: boolean; existingCaches?: string[] }) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const store = new Map<string, Map<string, string>>(); // cache name -> url -> body
  for (const name of opts.existingCaches ?? []) store.set(name, new Map([["/old", "old"]]));
  let skipped = false;
  let claimed = false;

  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: () => (skipped = true),
    clients: { claim: async () => (claimed = true) },
  };
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name)!;
      return { add: async (url: string) => void c.set(url, `body of ${url}`) };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (url: string) => {
      for (const c of store.values()) if (c.has(url)) return c.get(url);
      return undefined;
    },
  };
  const fetchFn = async (req: { url: string }) => {
    if (!opts.online) throw new TypeError("offline");
    return `network:${req.url}`;
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, fetch: fetchFn });
  return { listeners, store, state: () => ({ skipped, claimed }) };
}

/** Fires a fetch event and reports what the service worker answered, or null if it stayed out of it. */
async function fire(sw: ReturnType<typeof loadServiceWorker>, request: { mode: string; url: string }) {
  let answered: Promise<unknown> | null = null;
  sw.listeners.fetch({ request, respondWith: (p: Promise<unknown>) => (answered = p) });
  return answered ? await answered : null;
}

test("sw: installing stores only the offline page", async () => {
  const sw = loadServiceWorker({ online: true });
  let waited: Promise<unknown> = Promise.resolve();
  sw.listeners.install({ waitUntil: (p: Promise<unknown>) => (waited = p) });
  await waited;
  assert.deepEqual([...sw.store.get("actionbrain-offline-v2")!.keys()], ["/offline.html"]);
  assert.equal(sw.state().skipped, true);
});

test("sw: a page load works normally when online", async () => {
  const sw = loadServiceWorker({ online: true });
  assert.equal(await fire(sw, { mode: "navigate", url: "/tasks" }), "network:/tasks");
});

test("sw: a page load while offline shows the offline page", async () => {
  const sw = loadServiceWorker({ online: true });
  let waited: Promise<unknown> = Promise.resolve();
  sw.listeners.install({ waitUntil: (p: Promise<unknown>) => (waited = p) });
  await waited;

  const offline = loadServiceWorker({ online: false });
  offline.store.set("actionbrain-offline-v2", sw.store.get("actionbrain-offline-v2")!);
  assert.equal(await fire(offline, { mode: "navigate", url: "/tasks" }), "body of /offline.html");
});

test("sw: it never touches API calls, scripts or Supabase requests", async () => {
  const sw = loadServiceWorker({ online: false });
  for (const mode of ["cors", "same-origin", "no-cors"]) {
    assert.equal(await fire(sw, { mode, url: "/api/command" }), null, `mode ${mode} must be ignored`);
  }
});

test("sw: activating removes every old cache version and keeps only the current one", async () => {
  const sw = loadServiceWorker({ online: true, existingCaches: ["actionbrain-offline-v0", "actionbrain-offline-v1", "actionbrain-offline-v2"] });
  let waited: Promise<unknown> = Promise.resolve();
  sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => (waited = p) });
  await waited;
  assert.deepEqual([...sw.store.keys()], ["actionbrain-offline-v2"]);
  assert.equal(sw.state().claimed, true);
});

test("sw: the file itself never caches anything but the offline page", () => {
  const src = readFileSync("public/sw.js", "utf8");
  assert.equal((src.match(/\.add\(/g) ?? []).length, 1);
  assert.ok(!/\.put\(|addAll\(/.test(src));
});

// ---------------- redirect and share helpers ----------------

test("safeNextPath allows normal paths on this site", () => {
  for (const ok of ["/dashboard", "/inbox?text=hello%20world&url=https%3A%2F%2Fa.com", "/tasks#top"]) {
    assert.equal(safeNextPath(ok), ok);
  }
});

test("safeNextPath blocks every way of leaving the site", () => {
  for (const bad of [
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "evil.com",
    "/ /evil.com",
    "/%0d%0a".replace("%0d%0a", "\r\n") + "x",
    "/dash\tboard",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeNextPath(bad as string), null, JSON.stringify(bad));
  }
});

test("safeNextPath never loops back to the login page, and caps absurd lengths", () => {
  assert.equal(safeNextPath("/login"), null);
  assert.equal(safeNextPath("/login?x=1"), null);
  assert.equal(safeNextPath("/" + "a".repeat(2500)), null);
});

test("shared text: combines title, text and url; trims; caps length; null when empty", () => {
  assert.equal(sharedTextFrom("?title=Hi&text=Please%20send%20the%20RCA&url=https%3A%2F%2Fx.com%2Fa"), "Hi\nPlease send the RCA\nhttps://x.com/a");
  assert.equal(sharedTextFrom("?text=%20%20only%20text%20"), "only text");
  assert.equal(sharedTextFrom(""), null);
  assert.equal(sharedTextFrom("?title=&text=%20"), null);
  assert.equal(sharedTextFrom("?text=" + "x".repeat(9000))!.length, 6000);
});

// The bug this guards against: offline, the browser loaded a Next.js-rendered page under the wrong address, the app
// tried to start as that address, and crashed into the error screen. The offline page must be inert HTML.
test("offline page is static HTML that cannot start the app", () => {
  const html = readFileSync("public/offline.html", "utf8");
  assert.ok(html.toLowerCase().startsWith("<!doctype html>"));
  assert.ok(!/<script/i.test(html), "offline.html must contain no scripts");
  assert.ok(!/(src|href)=["']https?:/i.test(html), "offline.html must not depend on any external file");
  assert.ok(!/_next\//.test(html), "offline.html must not reference Next.js bundles");
  assert.match(html, /You are offline/);
});

test("there is no Next.js /offline route that could be cached by mistake", () => {
  assert.equal(existsSync("src/app/offline/page.tsx"), false);
});
