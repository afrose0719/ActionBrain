import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAndroidBridge, parseAndroidStatus, parseSharedFile } from "../src/lib/android-bridge.ts";
import { looksLikeToken } from "../src/lib/intake.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const fullBridge = () => ({
  isApp: () => true,
  saveIntake: () => true,
  clearIntake: () => {},
  takeSharedFile: () => "",
  status: () => "{}",
  openNotificationAccess: () => {},
  openBatterySettings: () => {},
  openAppInfo: () => {},
});
const goodStatus = { app: true, version: "0.1.0", configured: true, listening: false, sent: 3, failed: 1, lastAt: 1790000000000, lastResult: "stored" };

// ---- the bridge object ----
test("in an ordinary browser there is no bridge", () => {
  assert.equal(getAndroidBridge({}), null);
  assert.equal(getAndroidBridge(undefined), null);
  assert.equal(getAndroidBridge({ ActionBrainAndroid: null }), null);
  assert.equal(getAndroidBridge({ ActionBrainAndroid: "yes" }), null);
});

test("the bridge is recognised only when every method is there", () => {
  const bridge = fullBridge();
  assert.equal(getAndroidBridge({ ActionBrainAndroid: bridge }), bridge);
  for (const name of Object.keys(bridge)) {
    const partial: Record<string, unknown> = { ...bridge };
    delete partial[name];
    assert.equal(getAndroidBridge({ ActionBrainAndroid: partial }), null, `missing ${name}`);
    assert.equal(getAndroidBridge({ ActionBrainAndroid: { ...bridge, [name]: "not a function" } }), null, `${name} not a function`);
  }
});

// ---- the status text ----
test("a good status is read", () => {
  assert.deepEqual(parseAndroidStatus(JSON.stringify(goodStatus)), {
    version: "0.1.0",
    configured: true,
    listening: false,
    sent: 3,
    failed: 1,
    lastAt: 1790000000000,
    lastResult: "stored",
  });
});

test("anything that is not exactly the expected shape is refused", () => {
  const bad: unknown[] = [
    undefined,
    null,
    42,
    "",
    "{not json",
    "null",
    "[]",
    JSON.stringify({}),
    JSON.stringify({ ...goodStatus, app: false }),
    JSON.stringify({ ...goodStatus, version: 1 }),
    JSON.stringify({ ...goodStatus, configured: "yes" }),
    JSON.stringify({ ...goodStatus, listening: 1 }),
    JSON.stringify({ ...goodStatus, sent: -1 }),
    JSON.stringify({ ...goodStatus, failed: "2" }),
    JSON.stringify({ ...goodStatus, lastAt: null }),
    JSON.stringify({ ...goodStatus, lastResult: null }),
  ];
  for (const input of bad) assert.equal(parseAndroidStatus(input), null, String(input));
});

test("numbers are whole and text is cut, so a odd status cannot break the page", () => {
  const s = parseAndroidStatus(JSON.stringify({ ...goodStatus, sent: 2.9, version: "v".repeat(100), lastResult: "r".repeat(1000) }));
  assert.equal(s?.sent, 2);
  assert.equal(s?.version.length, 20);
  assert.equal(s?.lastResult.length, 120);
});

// ---- a chat shared to the app ----
test("nothing waiting, or something that is not the expected shape, is null", () => {
  for (const input of [undefined, null, 5, "", "{not json", "null", "[]", "{}", JSON.stringify({ name: "a.txt" }), JSON.stringify({ text: "x" }), JSON.stringify({ name: 1, text: "x" })]) {
    assert.equal(parseSharedFile(input), null, String(input));
  }
});

test("a shared chat is read, including quotes, newlines and other scripts", () => {
  const text = ["line one", String.raw`"quoted" \ राजेश 📷`].join("\n");
  assert.deepEqual(parseSharedFile(JSON.stringify({ name: "WhatsApp Chat with Rajesh.txt", text })), { ok: true, name: "WhatsApp Chat with Rajesh.txt", text });
});

test("an error from the app is passed on, cut to a safe length", () => {
  assert.deepEqual(parseSharedFile(JSON.stringify({ error: "too big" })), { ok: false, error: "too big" });
  assert.equal((parseSharedFile(JSON.stringify({ error: "e".repeat(999) })) as { error: string }).error.length, 200);
});

test("the inbox uses ONE import function for both the file picker and the app hand-off", () => {
  const inbox = read("src/app/(app)/inbox/page.tsx");
  assert.equal((inbox.match(/importFrom\(/g) ?? []).length, 2); // the file picker and the app hand-off, both through src/lib/import/chat.ts
  assert.ok(inbox.includes('get("shared") !== "file"'));
  assert.ok(inbox.includes("takeSharedFile()"));
});

// ---- the Kotlin side and this side must agree ----
const kotlinPayload = read("android/app/src/main/java/app/actionbrain/android/Payload.kt");
const kotlinBridge = read("android/app/src/main/java/app/actionbrain/android/WebBridge.kt");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const gradle = read("android/app/build.gradle.kts");

test("the app and the website use the same token format", () => {
  assert.ok(kotlinPayload.includes('Regex("^abi_[A-Za-z0-9_-]{43}$")'));
  assert.equal(looksLikeToken("abi_" + "A".repeat(43)), true);
});

test("every method the website calls exists in the app's bridge, and nothing extra is exposed", () => {
  const exposed = [...kotlinBridge.matchAll(/@JavascriptInterface\s+fun (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(exposed, ["clearIntake", "isApp", "openAppInfo", "openBatterySettings", "openNotificationAccess", "saveIntake", "status", "takeSharedFile"]);
  const website = Object.keys(fullBridge()).sort();
  assert.deepEqual(exposed, website);
});

test("the app sends to the address the website's route serves", () => {
  assert.ok(kotlinPayload.includes('"/api/intake"'));
  assert.ok(readFileSync(new URL("../src/app/api/intake/route.ts", import.meta.url), "utf8").includes("POST /api/intake"));
  assert.ok(read("src/components/phone-intake.tsx").includes("/api/intake"));
});

test("the app asks for the bare minimum of permissions", () => {
  const perms = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(perms, ["android.permission.INTERNET", "android.permission.RECORD_AUDIO"]);
  for (const forbidden of ["READ_CALL_LOG", "READ_PHONE_STATE", "READ_SMS", "RECEIVE_SMS", "READ_CONTACTS", "CAMERA", "ACCESS_FINE_LOCATION", "MANAGE_EXTERNAL_STORAGE"]) {
    assert.ok(!manifest.includes(forbidden), forbidden);
  }
});

test("the app is locked down: https only, no backups, listener protected by the system permission", () => {
  assert.ok(manifest.includes('android:usesCleartextTraffic="false"'));
  assert.ok(manifest.includes('android:allowBackup="false"'));
  assert.ok(manifest.includes('android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"'));
  assert.ok(gradle.includes('appUrl.startsWith("https://")'));
});

test("only WhatsApp's notifications are read", () => {
  const service = read("android/app/src/main/java/app/actionbrain/android/WhatsAppListenerService.kt");
  const packages = service.match(/setOf\(([^)]*)\)/)?.[1].split(",").map((p) => p.trim().replace(/"/g, ""));
  assert.deepEqual(packages, ["com.whatsapp", "com.whatsapp.w4b"]);
});

test("the website the app opens is the deployed one, and the app keeps to that one site", () => {
  assert.ok(read("android/gradle.properties").includes("actionbrainUrl=https://action-brain-sigma.vercel.app"));
  const activity = read("android/app/src/main/java/app/actionbrain/android/MainActivity.kt");
  assert.ok(activity.includes('uri.scheme == "https" && uri.host == appHost'));
  assert.ok(activity.includes("request.origin.host != appHost"));
});
