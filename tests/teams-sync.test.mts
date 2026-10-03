import { test } from "node:test";
import assert from "node:assert/strict";
import { SYNC_EVERY_MS, isDue, syncTeamsIfDue } from "../src/lib/teams-sync.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

function fakeServer(opts: { configured?: boolean; connected?: boolean; syncStatus?: number; stored?: number } = {}) {
  const calls: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/microsoft/status") return json({ configured: opts.configured ?? true, connected: opts.connected ?? true });
    if (url === "/api/microsoft/sync") return opts.syncStatus && opts.syncStatus >= 400 ? json({ error: "nope" }, opts.syncStatus) : json({ ok: true, stored: opts.stored ?? 2 });
    throw new Error(`unexpected ${url}`);
  };
  return { fetcher, calls };
}

test("a sync is due the first time, then only after two minutes", () => {
  assert.equal(isDue(1_000_000, null), true);
  assert.equal(isDue(1_000_000, 1_000_000 - SYNC_EVERY_MS + 1), false);
  assert.equal(isDue(1_000_000, 1_000_000 - SYNC_EVERY_MS), true);
  assert.equal(isDue(1_000_000, 0), true);
});

test("a clock that moved backwards, or a damaged stored value, never blocks syncing for ever", () => {
  assert.equal(isDue(1_000, 5_000), true);
  assert.equal(isDue(1_000, Number.NaN), true);
  assert.equal(isDue(1_000, Number.POSITIVE_INFINITY), true);
});

test("when due and connected, it syncs once and reports how many messages arrived", async () => {
  const server = fakeServer({ stored: 3 });
  const store = memory();
  assert.deepEqual(await syncTeamsIfDue(server.fetcher, store, "Asia/Kolkata", 5_000_000), { stored: 3 });
  assert.deepEqual(server.calls, ["GET /api/microsoft/status", "POST /api/microsoft/sync"]);
  assert.equal(store.data.get("ms_last_sync"), "5000000");
});

test("the time zone is passed to the server, so each line is stamped in the person's own time", async () => {
  let sent = "";
  const fetcher = async (url: string, init?: RequestInit) => {
    if (url === "/api/microsoft/sync") sent = String(init?.body);
    return url.endsWith("status") ? json({ configured: true, connected: true }) : json({ stored: 0 });
  };
  await syncTeamsIfDue(fetcher, memory(), "Asia/Kolkata", 1);
  assert.deepEqual(JSON.parse(sent), { timeZone: "Asia/Kolkata" });
});

test("a second call within two minutes does nothing, not even a status request", async () => {
  const server = fakeServer();
  const store = memory();
  await syncTeamsIfDue(server.fetcher, store, "UTC", 5_000_000);
  server.calls.length = 0;
  assert.equal(await syncTeamsIfDue(server.fetcher, store, "UTC", 5_000_000 + 60_000), null);
  assert.deepEqual(server.calls, []);
  assert.deepEqual(await syncTeamsIfDue(server.fetcher, store, "UTC", 5_000_000 + SYNC_EVERY_MS), { stored: 2 });
});

test("two quick calls cannot both sync: the time is marked before the request starts", async () => {
  const server = fakeServer();
  const store = memory();
  const [a, b] = await Promise.all([syncTeamsIfDue(server.fetcher, store, "UTC", 9_000_000), syncTeamsIfDue(server.fetcher, store, "UTC", 9_000_000)]);
  assert.equal([a, b].filter((r) => r !== null).length, 1);
  assert.equal(server.calls.filter((c) => c.includes("sync")).length, 1);
});

test("not connected, or not set up on the server: no sync request is made", async () => {
  for (const opts of [{ connected: false }, { configured: false }, { configured: false, connected: false }]) {
    const server = fakeServer(opts);
    assert.equal(await syncTeamsIfDue(server.fetcher, memory(), "UTC", 1), null);
    assert.deepEqual(server.calls, ["GET /api/microsoft/status"]);
  }
});

test("a server error is silent here (Settings is where it is shown) and does not throw", async () => {
  assert.equal(await syncTeamsIfDue(fakeServer({ syncStatus: 500 }).fetcher, memory(), "UTC", 1), null);
  assert.equal(await syncTeamsIfDue(fakeServer({ syncStatus: 400 }).fetcher, memory(), "UTC", 1), null);
  const failingStatus = async () => json({}, 401);
  assert.equal(await syncTeamsIfDue(failingStatus, memory(), "UTC", 1), null);
});

test("blocked browser storage does not stop it from working", async () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(await syncTeamsIfDue(fakeServer({ stored: 1 }).fetcher, blocked, "UTC", 1), { stored: 1 });
});

test("an answer without a count is read as zero new messages", async () => {
  const fetcher = async (url: string) => (url.endsWith("status") ? json({ configured: true, connected: true }) : json({ ok: true }));
  assert.deepEqual(await syncTeamsIfDue(fetcher, memory(), "UTC", 1), { stored: 0 });
});
