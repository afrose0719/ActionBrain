import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CALENDAR_SCOPE,
  accessTokenFrom,
  buildAuthUrl,
  emailFromIdToken,
  exchangeCode,
  listEvents,
  redirectUri,
} from "../src/lib/google.ts";

process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "shh";

const idToken = "x." + Buffer.from(JSON.stringify({ email: "afrose@gmail.com" })).toString("base64url") + ".y";
const goodToken = {
  access_token: "AT",
  refresh_token: "RT",
  scope: `openid email ${CALENDAR_SCOPE}`,
  id_token: idToken,
};

// A fake Google: tests set `reply`, and every request is recorded in `calls`.
type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as Response;
  }) as typeof fetch;
});

test("auth URL asks for read-only calendar access, offline, with the state", () => {
  const url = new URL(buildAuthUrl("cid", "http://localhost:3000/google/callback", "state-123456789012345"));
  assert.equal(url.host, "accounts.google.com");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "state-123456789012345");
  const scopes = url.searchParams.get("scope")!.split(" ");
  assert.deepEqual(scopes.filter((s) => s.includes("calendar")), [CALENDAR_SCOPE]);
  assert.ok(CALENDAR_SCOPE.endsWith("calendar.events.readonly"));
});

test("redirect URI defaults to the request's own origin", () => {
  assert.equal(redirectUri(new Request("http://localhost:3000/api/google/connect")), "http://localhost:3000/google/callback");
});

test("reads the email from the id_token, and tolerates junk", () => {
  assert.equal(emailFromIdToken(idToken), "afrose@gmail.com");
  assert.equal(emailFromIdToken("garbage"), null);
  assert.equal(emailFromIdToken(undefined), null);
});

test("code exchange succeeds and keeps the secret on the server side of the request", async () => {
  reply = { status: 200, body: goodToken };
  const r = await exchangeCode("code", "http://localhost:3000/google/callback");
  assert.deepEqual(r, { refreshToken: "RT", email: "afrose@gmail.com" });
  const sent = String(calls[0].init!.body);
  assert.ok(sent.includes("client_secret=shh") && sent.includes("grant_type=authorization_code"));
});

test("code exchange rejects a missing refresh token", async () => {
  reply = { status: 200, body: { ...goodToken, refresh_token: undefined } };
  await assert.rejects(exchangeCode("c", "r"), /refresh token/i);
});

test("code exchange rejects when the calendar permission was un-ticked", async () => {
  reply = { status: 200, body: { ...goodToken, scope: "openid email" } };
  await assert.rejects(exchangeCode("c", "r"), /Calendar access was not granted/);
});

test("an expired or revoked token is reported as TOKEN_REVOKED", async () => {
  reply = { status: 400, body: { error: "invalid_grant" } };
  await assert.rejects(accessTokenFrom("old"), (e: { code?: string }) => e.code === "TOKEN_REVOKED");
});

test("refresh returns a fresh access token", async () => {
  reply = { status: 200, body: { access_token: "NEWAT" } };
  assert.equal(await accessTokenFrom("RT"), "NEWAT");
});

test("events: drops cancelled, declined and start-less ones; hides you and rooms from attendees", async () => {
  reply = {
    status: 200,
    body: {
      items: [
        {
          id: "1",
          summary: "WATI sync",
          start: { dateTime: "2026-10-02T10:00:00+05:30" },
          hangoutLink: "https://meet.google.com/abc",
          attendees: [{ email: "me@x.com", self: true }, { displayName: "Rajesh", email: "r@x.com" }, { email: "room@res.x.com", resource: true }, { email: "anish@x.com" }],
        },
        { id: "2", status: "cancelled", summary: "Cancelled", start: { dateTime: "2026-10-02T11:00:00Z" } },
        { id: "3", summary: "Declined", start: { dateTime: "2026-10-02T12:00:00Z" }, attendees: [{ self: true, responseStatus: "declined" }] },
        { id: "4", summary: "Holiday", start: { date: "2026-10-02" } },
        { id: "5", start: { dateTime: "2026-10-03T09:00:00Z" } },
        { id: "6", summary: "No start" },
      ],
    },
  };
  const ev = await listEvents("AT", new Date("2026-09-25"), new Date("2026-10-09"));
  assert.deepEqual(ev.map((e) => e.id), ["1", "4", "5"]);
  assert.deepEqual(ev[0].attendees, ["Rajesh", "anish@x.com"]);
  assert.equal(ev[0].link, "https://meet.google.com/abc");
  assert.equal(ev[1].allDay, true);
  assert.equal(ev[2].title, "(No title)");
});

test("events request is a read-only GET with recurring events expanded", async () => {
  reply = { status: 200, body: { items: [] } };
  await listEvents("AT", new Date(), new Date());
  const c = calls[0];
  assert.ok(c.url.includes("singleEvents=true") && c.url.includes("orderBy=startTime"));
  assert.ok(!c.init?.method || c.init.method === "GET");
  assert.equal((c.init!.headers as Record<string, string>).authorization, "Bearer AT");
});

test("a Google API error is surfaced with its message", async () => {
  reply = { status: 403, body: { error: { message: "Insufficient Permission" } } };
  await assert.rejects(listEvents("AT", new Date(), new Date()), /Insufficient Permission/);
});
