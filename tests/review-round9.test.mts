import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { botError, botRequest, cleanBotReply, isPublicAddress, parseMeetingLink } from "../src/lib/notetaker.ts";
import { getSecret, migrateSecret, setSecret } from "../src/lib/secret-store.ts";

const g = globalThis as Record<string, unknown>;
class Mem {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
afterEach(() => delete g.window);

test("the page's security policy lets the browser reach Sarvam and OpenAI (cloud speech was blocked before)", () => {
  const cfg = readFileSync("next.config.ts", "utf8");
  const connect = cfg.split("\n").find((l) => l.includes("connect-src 'self' https://*.supabase.co"))!;
  assert.ok(connect.includes("https://api.sarvam.ai") && connect.includes("https://api.openai.com"));
  const scriptSrc = cfg.split("\n").find((l) => l.includes("`script-src 'self' 'unsafe-inline'"))!;
  assert.ok(scriptSrc.includes(`\${isDev ? " 'unsafe-eval'" : ""}`), "eval only in development");
});

test("Vexa is always asked not to keep the meeting audio (browser relay and helper)", () => {
  assert.equal(botRequest(parseMeetingLink("https://meet.google.com/abc-defg-hij")!).recording_enabled, false);
  assert.ok(readFileSync("src/app/api/notetaker/route.ts", "utf8").includes("recording_enabled: false"));
  assert.ok(readFileSync("desktop/main.cjs", "utf8").includes("recording_enabled: false"));
});

test("only the fields the page uses come back from the bot service", () => {
  assert.deepEqual(cleanBotReply("send", { platform: "teams", native_meeting_id: "123456789", status: "requested", internal: "secret", user: { email: "x" } }), {
    platform: "teams",
    native_meeting_id: "123456789",
    status: "requested",
  });
  const t = cleanBotReply("transcript", { segments: [{ text: "hi", speaker: "A", absolute_start_time: "2026-11-28T10:00:00Z", audio_url: "s3://x" }], meeting: { token: "t" } }) as {
    segments: Record<string, unknown>[];
  };
  assert.deepEqual(Object.keys(t), ["segments"]);
  assert.equal(t.segments[0].audio_url, undefined);
  const st = cleanBotReply("status", { running_bots: [{ platform: "google_meet", native_meeting_id: "abc-defg-hij", container: "c1" }] }) as { running: Record<string, unknown>[] };
  assert.deepEqual(st.running, [{ platform: "google_meet", native_meeting_id: "abc-defg-hij", status: undefined }]);
});

test("errors from the bot service are explained without echoing its message", () => {
  assert.match(botError(401), /refused the key/);
  assert.match(botError(402), /no credit/);
  assert.equal(botError(500), "The bot service had a problem (500).");
});

test("a self-hosted bot service must resolve to public addresses only", () => {
  for (const ip of ["8.8.8.8", "34.120.1.2", "2606:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.9.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  const route = readFileSync("src/app/api/notetaker/route.ts", "utf8");
  assert.ok(route.includes("lookup(url.hostname, { all: true })") && route.includes("tooMany(auth.user.id)"));
});

test("keys are forgotten when the browser closes unless 'remember' is ticked; old saved keys are moved once", () => {
  const session = new Mem();
  const local = new Mem();
  g.window = { sessionStorage: session, localStorage: local };
  setSecret("sarvam", "sk_1", false);
  assert.deepEqual(getSecret("sarvam"), { value: "sk_1", remembered: false });
  assert.equal(local.m.size, 0, "nothing on the device by default");
  setSecret("sarvam", "sk_2", true);
  assert.deepEqual(getSecret("sarvam"), { value: "sk_2", remembered: true });
  assert.equal(session.m.size, 0);
  setSecret("sarvam", "", true);
  assert.equal(getSecret("sarvam").value, "");
  migrateSecret("vexa", "vxa_old");
  assert.deepEqual(getSecret("vexa"), { value: "vxa_old", remembered: true });
});

test("helper: visible recording bar with Stop/Skip, red tray icon, history without content, sleep handling, fuses", () => {
  const main = readFileSync("desktop/main.cjs", "utf8");
  for (const s of ["showIndicator(", "#stop", "#skip", "icon-recording.png", 'powerMonitor.on("suspend"', "Recent calls", "outcome"]) assert.ok(main.includes(s), s);
  assert.ok(!/history[^\n]*transcript/.test(main), "history keeps no content");
  const pkg = JSON.parse(readFileSync("desktop/package.json", "utf8"));
  assert.equal(pkg.build.electronFuses.runAsNode, false);
  assert.equal(pkg.build.electronFuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(pkg.build.electronFuses.onlyLoadAppFromAsar, true);
  const preload = readFileSync("desktop/preload.cjs", "utf8");
  assert.ok(!/exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/.test(preload), "never exposes ipcRenderer itself");
});
