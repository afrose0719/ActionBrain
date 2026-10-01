import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// A tiny fake of chrome.storage so the extension's own code can run under Node.
const store: Record<string, unknown> = {};
(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      async get(key: string) {
        return { [key]: store[key] };
      },
      async set(obj: Record<string, unknown>) {
        Object.assign(store, obj);
      },
      async remove(key: string) {
        delete store[key];
      },
    },
  },
};

const { fetchReminderData, sendToInbox } = await import("../extension/api.js");

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
let respond: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: [] });

beforeEach(() => {
  calls = [];
  delete store.session;
  respond = () => ({ status: 200, body: [] });
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = respond(String(url));
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  }) as typeof fetch;
});

const loggedIn = (expiresInMs = 3_600_000) => {
  store.session = { access_token: "TOKEN", refresh_token: "R1", expires_at: Date.now() + expiresInMs, email: "a@b.c" };
};

test("reminders: not logged in means no data and no network calls", async () => {
  assert.equal(await fetchReminderData(), null);
  assert.equal(calls.length, 0);
});

test("reminders: reads tasks and commitments with the user's token (read-only GETs)", async () => {
  loggedIn();
  respond = (url) => ({ status: 200, body: url.includes("/tasks") ? [{ id: "t1" }] : [{ id: "c1" }] });
  const data = await fetchReminderData(Date.parse("2026-10-05T10:00:00Z"));
  assert.deepEqual(data, { tasks: [{ id: "t1" }], commitments: [{ id: "c1" }] });
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.ok(!c.init.method || c.init.method === "GET");
    assert.equal((c.init.headers as Record<string, string>).authorization, "Bearer TOKEN");
  }
  const tasksUrl = calls.find((c) => c.url.includes("/rest/v1/tasks"))!.url;
  assert.ok(tasksUrl.includes("status=eq.todo"));
  assert.ok(tasksUrl.includes("due_date=gte.2026-09-27")); // 8 days back
  assert.ok(tasksUrl.includes("due_date=lte.2026-10-05T12%3A00")); // 2 hours ahead, URL-encoded
  assert.ok(calls.find((c) => c.url.includes("/rest/v1/commitments"))!.url.includes("status=eq.open"));
});

test("reminders: an API failure throws, so the alarm just retries later", async () => {
  loggedIn();
  respond = () => ({ status: 500, body: {} });
  await assert.rejects(fetchReminderData(), /Could not read/);
});

test("an expired login is refreshed before use, and the new refresh token is kept", async () => {
  loggedIn(-1000);
  respond = (url) =>
    url.includes("grant_type=refresh_token")
      ? { status: 200, body: { access_token: "NEW", refresh_token: "R2", expires_in: 3600, user: { email: "a@b.c" } } }
      : { status: 200, body: [] };
  await fetchReminderData();
  const data = calls.find((c) => c.url.includes("/rest/v1/tasks"))!;
  assert.equal((data.init.headers as Record<string, string>).authorization, "Bearer NEW");
  assert.equal((store.session as { refresh_token: string }).refresh_token, "R2");
});

test("a refresh that fails logs the user out instead of looping", async () => {
  loggedIn(-1000);
  respond = () => ({ status: 400, body: { error_description: "invalid" } });
  assert.equal(await fetchReminderData(), null);
  assert.equal(store.session, undefined);
});

test("send: blocked when logged out, and empty text is rejected", async () => {
  assert.deepEqual(await sendToInbox("hello"), { ok: false, error: "Please log in: click the ActionBrain icon in the toolbar." });
  loggedIn();
  assert.deepEqual(await sendToInbox("   "), { ok: false, error: "No text selected." });
});

test("send: caps text at 6000 characters and records the page as the source", async () => {
  loggedIn();
  const r = await sendToInbox("x".repeat(9000), { title: "T", url: "https://e.com" });
  assert.deepEqual(r, { ok: true });
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.content.length, 6000);
  assert.equal(body.source_type, "browser");
  assert.equal(body.source_ref, "T — https://e.com");
  assert.equal(calls[0].init.method, "POST");
});

test("send: a database rejection is reported, not hidden", async () => {
  loggedIn();
  respond = () => ({ status: 401, body: { message: "row violates row-level security policy" } });
  const r = await sendToInbox("hello");
  assert.equal(r.ok, false);
  assert.match(r.error, /row-level security/);
});
