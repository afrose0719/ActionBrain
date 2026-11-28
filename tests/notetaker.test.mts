import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { botRequest, meetingsToJoin, parseMeetingLink, safeBaseUrl, speakersOf, transcriptText } from "../src/lib/notetaker.ts";

test("reads Meet, Teams and Zoom links; refuses anything else", () => {
  assert.deepEqual(parseMeetingLink("https://meet.google.com/abc-defg-hij?authuser=0"), {
    platform: "google_meet",
    nativeId: "abc-defg-hij",
    meetingUrl: "https://meet.google.com/abc-defg-hij?authuser=0",
  });
  const t = parseMeetingLink("https://teams.microsoft.com/meet/397421056486982?p=X8hcQVTn");
  assert.equal(t?.platform, "teams");
  assert.equal(t?.nativeId, "397421056486982");
  assert.equal(t?.passcode, "X8hcQVTn");
  const classic = parseMeetingLink("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%7d");
  assert.equal(classic?.nativeId, "", "classic links are sent whole");
  const z = parseMeetingLink("https://us02web.zoom.us/j/81234567890?pwd=secret");
  assert.equal(z?.nativeId, "81234567890");
  assert.equal(z?.passcode, "secret");
  for (const bad of ["http://meet.google.com/abc-defg-hij", "https://meet.google.com.evil.com/abc-defg-hij", "https://example.com/j/123456789", "not a link", "https://meet.google.com/landing"]) {
    assert.equal(parseMeetingLink(bad), null, bad);
  }
});

test("the bot request: visible name, passcode separate, classic Teams link whole, language only when chosen", () => {
  assert.deepEqual(botRequest(parseMeetingLink("https://teams.microsoft.com/meet/397421056486982?p=X8")!), {
    recording_enabled: false,
    bot_name: "ActionBrain Notetaker",
    platform: "teams",
    native_meeting_id: "397421056486982",
    passcode: "X8",
  });
  const classic = botRequest(parseMeetingLink("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=x")!);
  assert.ok(classic.meeting_url && !classic.native_meeting_id);
  assert.equal(botRequest(parseMeetingLink("https://meet.google.com/abc-defg-hij")!, { language: "tamil" }).language, "ta");
  assert.equal(botRequest(parseMeetingLink("https://meet.google.com/abc-defg-hij")!, { language: null }).language, undefined, "auto per speaker turn");
});

test("speaker-labelled transcript: in time order, one paragraph per turn, repeats dropped", () => {
  const segs = [
    { speaker: "Priya", text: "Quote Friday-kulla anuppuren.", absolute_start_time: "2026-11-28T10:00:05Z" },
    { speaker: "Afrose", text: "Okay, thanks.", absolute_start_time: "2026-11-28T10:00:09Z" },
    { speaker: "Priya", text: "Hi all,", absolute_start_time: "2026-11-28T10:00:01Z" },
    { speaker: "Priya", text: "Quote Friday-kulla anuppuren.", absolute_start_time: "2026-11-28T10:00:05Z" },
    { speaker: "", text: "  ", absolute_start_time: "2026-11-28T10:00:10Z" },
  ];
  assert.equal(transcriptText(segs), "Priya: Hi all, Quote Friday-kulla anuppuren.\n\nAfrose: Okay, thanks.");
  assert.deepEqual(speakersOf(segs), ["Priya", "Afrose"]);
  assert.equal(transcriptText([]), "");
});

test("auto-join picks meetings starting now (2 min ago to 1 min ahead), with a link, not sent before", () => {
  const now = Date.parse("2026-11-28T10:00:00Z");
  const ev = (id: string, start: string, link: string | null, allDay = false) => ({ id, title: id, start, allDay, link });
  const picked = meetingsToJoin(
    [
      ev("now", "2026-11-28T10:00:30Z", "https://meet.google.com/abc-defg-hij"),
      ev("late", "2026-11-28T09:59:00Z", "https://meet.google.com/abc-defg-hij"),
      ev("soon", "2026-11-28T10:05:00Z", "https://meet.google.com/abc-defg-hij"),
      ev("old", "2026-11-28T09:50:00Z", "https://meet.google.com/abc-defg-hij"),
      ev("nolink", "2026-11-28T10:00:00Z", null),
      ev("phone", "2026-11-28T10:00:00Z", "https://example.com/call"),
      ev("done", "2026-11-28T10:00:00Z", "https://meet.google.com/abc-defg-hij"),
      ev("allday", "2026-11-28", "https://meet.google.com/abc-defg-hij", true),
    ],
    now,
    new Set(["done"])
  );
  assert.deepEqual(picked.map((p) => p.id), ["now", "late"]);
});

test("the server only talks to a public https bot service (no internal addresses)", () => {
  assert.equal(safeBaseUrl("https://api.cloud.vexa.ai/"), "https://api.cloud.vexa.ai");
  assert.equal(safeBaseUrl("https://vexa.mycompany.com/api"), "https://vexa.mycompany.com/api");
  for (const bad of ["http://api.cloud.vexa.ai", "https://localhost:18056", "https://127.0.0.1", "https://10.0.0.5", "https://[::1]", "https://vexa.local", "https://intranet", "https://user:pw@vexa.ai", "ftp://x.com"]) {
    assert.equal(safeBaseUrl(bad), null, bad);
  }
});

test("the relay: logged-in users only, four fixed actions, no redirects, key never stored", () => {
  const route = readFileSync("src/app/api/notetaker/route.ts", "utf8");
  assert.ok(route.includes('if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 })'));
  assert.ok(route.includes('redirect: "error"'));
  assert.ok(route.includes("safeBaseUrl("));
  assert.ok(!/\.from\(|insert\(|upsert\(/.test(route), "nothing is saved by the relay");
  for (const a of ['case "send"', 'case "status"', 'case "transcript"', 'case "stop"']) assert.ok(route.includes(a));
});
