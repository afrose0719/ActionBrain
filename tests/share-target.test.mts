import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SHARED_CACHE, isSharedId } from "../src/lib/shared-files.ts";

// Runs the REAL public/sw.js against a fake browser that has real Request / Response / FormData / File objects.

const ORIGIN = "http://localhost:3000";
type Handler = (e: unknown) => void;

function loadWorker(preloaded: Record<string, { body: string; savedAt: number }> = {}) {
  const handlers: Record<string, Handler> = {};
  const caches = new Map<string, Map<string, Response>>();
  const shared = new Map<string, Response>();
  caches.set(SHARED_CACHE, shared);
  for (const [path, v] of Object.entries(preloaded)) shared.set(ORIGIN + path, new Response(v.body, { headers: { "x-saved-at": String(v.savedAt) } }));

  const keyOf = (r: Request | string) => (typeof r === "string" ? r : r.url);
  const cacheApi = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new Map());
      const c = caches.get(name)!;
      return {
        add: async (url: string) => void c.set(ORIGIN + url, new Response("offline page")),
        put: async (req: Request | string, res: Response) => void c.set(keyOf(req), res),
        keys: async () => [...c.keys()].map((u) => new Request(u)),
        match: async (req: Request | string) => c.get(keyOf(req))?.clone(),
        delete: async (req: Request | string) => c.delete(keyOf(req)),
      };
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
    match: async () => undefined,
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting() {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self,
    caches: cacheApi,
    fetch: async () => new Response("network"),
    URL,
    URLSearchParams,
    Response,
    Request,
    encodeURIComponent,
    Number,
    Date,
    Math,
    String,
  });
  return { handlers, caches, shared };
}

async function post(w: ReturnType<typeof loadWorker>, form: FormData, path = "/share-target") {
  let answered = null as Promise<Response> | null; // assigned later, by the service worker calling respondWith
  w.handlers.fetch({
    request: new Request(ORIGIN + path, { method: "POST", body: form }),
    respondWith: (p: Promise<Response>) => (answered = p),
  });
  return answered ? await answered : null;
}

const audio = (name = "Call with Rajesh.m4a", body = "AUDIO-BYTES", type = "audio/mp4") => new File([body], name, { type });

test("a shared call recording is stored for the page, and the user is sent to Meetings with its id", async () => {
  const w = loadWorker();
  const form = new FormData();
  form.append("audio", audio());
  const res = (await post(w, form))!;

  assert.equal(res.status, 303);
  const target = new URL(res.headers.get("location")!);
  assert.equal(target.pathname, "/meetings");
  const id = target.searchParams.get("shared")!;
  assert.ok(isSharedId(id), `"${id}" is not an id the page will accept`);

  const stored = w.shared.get(`${ORIGIN}/__shared/${id}`)!;
  assert.equal(await stored.text(), "AUDIO-BYTES");
  assert.equal(stored.headers.get("content-type"), "audio/mp4");
  assert.equal(decodeURIComponent(stored.headers.get("x-file-name")!), "Call with Rajesh.m4a");
});

test("shared text goes to the Inbox form with title, text and url, and nothing is stored", async () => {
  const w = loadWorker();
  const form = new FormData();
  form.append("title", "Re: RCA");
  form.append("text", "Can you send it by Friday?");
  form.append("url", "https://mail.example/1");
  const res = (await post(w, form))!;
  const target = new URL(res.headers.get("location")!);
  assert.equal(target.pathname, "/inbox");
  assert.equal(target.searchParams.get("text"), "Can you send it by Friday?");
  assert.equal(target.searchParams.get("title"), "Re: RCA");
  assert.equal(target.searchParams.get("url"), "https://mail.example/1");
  assert.equal(w.shared.size, 0);
});

test("a share with nothing useful, or a broken one, still lands safely on the Inbox", async () => {
  const w = loadWorker();
  assert.equal(new URL((await post(w, new FormData()))!.headers.get("location")!).pathname, "/inbox");
  const empty = new FormData();
  empty.append("audio", new File([], "empty.m4a")); // a zero-byte file is not a recording
  const res = (await post(w, empty))!;
  assert.equal(new URL(res.headers.get("location")!).pathname, "/inbox");
  assert.equal(w.shared.size, 0);
});

test("recordings nobody picked up are deleted after a day, but a fresh one is kept", async () => {
  const day = 24 * 60 * 60 * 1000;
  const w = loadWorker({
    "/__shared/1700000000000-old001": { body: "old", savedAt: Date.now() - 2 * day },
    "/__shared/1700000000001-new001": { body: "recent", savedAt: Date.now() - 1000 },
  });
  const form = new FormData();
  form.append("audio", audio());
  await post(w, form);
  const keys = [...w.shared.keys()];
  assert.ok(!keys.some((k) => k.includes("old001")), "the old one must be purged");
  assert.ok(keys.some((k) => k.includes("new001")), "the recent one must stay");
  assert.equal(keys.length, 2); // the recent one plus the one just shared
});

test("only POST /share-target is handled: other POSTs (the API) and a GET to it are left alone", async () => {
  const w = loadWorker();
  const form = new FormData();
  form.append("audio", audio());
  assert.equal(await post(w, form, "/api/command"), null);
  assert.equal(await post(w, form, "/api/inbox/analyze"), null);
  let answered = false;
  w.handlers.fetch({ request: new Request(ORIGIN + "/share-target", { method: "GET" }), respondWith: () => (answered = true) });
  assert.equal(answered, false);
  assert.equal(w.shared.size, 0, "nothing stored for requests it must not touch");
});

test("a service-worker update keeps shared recordings, and still deletes old offline caches", async () => {
  const w = loadWorker({ "/__shared/1700000000001-keep01": { body: "keep me", savedAt: Date.now() } });
  w.caches.set("actionbrain-offline-v1", new Map());
  w.caches.set("actionbrain-offline-v2", new Map());
  let waited: Promise<unknown> = Promise.resolve();
  w.handlers.activate({ waitUntil: (p: Promise<unknown>) => (waited = p) });
  await waited;
  assert.deepEqual([...w.caches.keys()].sort(), [SHARED_CACHE, "actionbrain-offline-v2"].sort());
  assert.equal(w.shared.size, 1);
});
