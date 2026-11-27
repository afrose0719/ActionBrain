import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAndroidStatus } from "../src/lib/android-bridge.ts";

// Milestone 30: the phone's durable, encrypted offline queue. Reads the REAL Kotlin and manifest, so a regression fails CI.
const kt = (f: string) => readFileSync(`android/app/src/main/java/app/actionbrain/android/${f}`, "utf8").replaceAll("\r\n", "\n");
const outbox = kt("Outbox.kt");
const client = kt("IntakeClient.kt");
const bridge = kt("WebBridge.kt");

test("every capture goes into the queue first; nothing is sent around it", () => {
  assert.ok(client.includes("= Outbox.add(context, json)"));
  assert.ok(outbox.indexOf("insert(app, json)") < outbox.indexOf("drain(app)"), "saved before the first attempt");
  for (const f of ["WhatsAppListenerService.kt"]) assert.ok(kt(f).includes("IntakeClient.send("));
});

test("messages are stored encrypted with a Keystore key, never as plain text", () => {
  assert.ok(outbox.includes('Vault("actionbrain_outbox_key")'));
  assert.ok(outbox.includes('put("payload", vault.encrypt(json))'));
  assert.ok(!/put\("payload", json\)/.test(outbox));
  assert.ok(kt("Vault.kt").includes('KeyStore.getInstance("AndroidKeyStore")') && kt("Vault.kt").includes("AES/GCM/NoPadding"));
  assert.ok(kt("TokenStore.kt").includes('Vault("actionbrain_intake_key")'), "the token keeps its old key, so saved tokens still open");
});

test("each retry carries the same event id, so the server stores the message once", () => {
  assert.ok(client.includes('setRequestProperty("x-actionbrain-event-id", eventId)'));
  assert.ok(outbox.includes("event_id text not null unique"));
  assert.ok(outbox.includes("IntakeClient.post(config, json, row.eventId)"));
});

test("deleted only after an answer; no network keeps it; bounded; disconnect clears it", () => {
  assert.ok(outbox.includes("code == null -> Action.KEEP_AND_RETRY"));
  assert.ok(outbox.includes("const val MAX_ROWS = 500") && outbox.includes("7L * 24 * 60 * 60 * 1000"));
  assert.ok(outbox.includes("Stats(context).drop("), "a dropped message is counted, never silent");
  assert.match(bridge, /fun clearIntake\(\) \{\s+tokens\.clear\(\)\s+Outbox\.clear\(activity\)/);
  assert.ok(bridge.includes("fun clearQueue(): Int"));
});

test("retries use Android's own JobScheduler with backoff and a network; the job is not exported", () => {
  assert.ok(outbox.includes("setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)"));
  assert.ok(outbox.includes("setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)"));
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.match(manifest, /android:name="\.OutboxJob"\s+android:exported="false"\s+android:permission="android\.permission\.BIND_JOB_SERVICE"/);
  assert.ok(kt("WhatsAppListenerService.kt").includes("override fun onListenerConnected()"), "restarts after a reboot");
});

test("Settings reads queued and dropped; older apps without them still work; wrong types are refused", () => {
  const base = { app: true, version: "0.7.0", configured: true, listening: true, sent: 3, failed: 0, lastAt: 0, lastResult: "" };
  assert.deepEqual([parseAndroidStatus(JSON.stringify(base))?.queued, parseAndroidStatus(JSON.stringify(base))?.dropped], [0, 0]);
  const s = parseAndroidStatus(JSON.stringify({ ...base, queued: 4, dropped: 1 }));
  assert.deepEqual([s?.queued, s?.dropped], [4, 1]);
  assert.equal(parseAndroidStatus(JSON.stringify({ ...base, queued: "4" })), null);
  assert.equal(parseAndroidStatus(JSON.stringify({ ...base, dropped: -1 })), null);
});
