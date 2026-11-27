import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// Store and open-source requirements that must never silently regress. Reads the REAL files.

test("the shared Android manifest (used by the Google Play build) never declares an Accessibility service", () => {
  const main = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  assert.doesNotMatch(main, /BIND_ACCESSIBILITY_SERVICE/);
  assert.doesNotMatch(main, /android\.accessibilityservice/);
  // the Google Play flavor has no manifest of its own that could add it back
  assert.equal(existsSync("android/app/src/play/AndroidManifest.xml"), false);
});

test("assistant capture (Milestone 31) is in the shared manifest, bound only by the system, and needs no Accessibility service", () => {
  const main = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  for (const name of [".ActionBrainAssistService", ".AssistSessionService", ".AssistRecognitionService"]) {
    const at = main.indexOf(`android:name="${name}"`);
    assert.ok(at > 0, name);
    const block = main.slice(at, main.indexOf(">", at));
    assert.match(block, /android:permission="android\.permission\.BIND_VOICE_INTERACTION"/, `${name} can only be bound by the system`);
  }
  const xml = readFileSync("android/app/src/main/res/xml/assist_service.xml", "utf8");
  assert.match(xml, /android:supportsAssist="true"/);
  assert.match(xml, /android:supportsLaunchVoiceAssistFromKeyguard="false"/, "never from the lock screen");
  const session = readFileSync("android/app/src/main/java/app/actionbrain/android/AssistService.kt", "utf8");
  assert.ok(session.indexOf("setOnClickListener { sendAll() }") > 0, "nothing is sent until the user taps Send");
  assert.ok(!/onHandleAssist[\s\S]{0,800}IntakeClient\.send/.test(session.slice(session.indexOf("override fun onHandleAssist"), session.indexOf("private fun read("))), "reading the screen never sends by itself");
  const bridge = readFileSync("android/app/src/main/java/app/actionbrain/android/WebBridge.kt", "utf8");
  const open = bridge.slice(bridge.indexOf("fun openAssistantSettings"), bridge.indexOf("fun openAssistantSettings") + 1200);
  assert.ok(open.indexOf("assist_consent_body") < open.indexOf("startActivity(target"), "disclosure before Android's screen");
});

test("the Accessibility service lives only in the sideloaded full build", () => {
  const full = readFileSync("android/app/src/full/AndroidManifest.xml", "utf8");
  assert.match(full, /BIND_ACCESSIBILITY_SERVICE/);
  const gradle = readFileSync("android/app/build.gradle.kts", "utf8");
  assert.match(gradle, /"SCREEN_READING", "false"/, "the play flavor must switch screen reading off");
});

test("Android shows its own disclosure before notification access and the microphone prompt", () => {
  const bridge = readFileSync("android/app/src/main/java/app/actionbrain/android/WebBridge.kt", "utf8");
  const fn = bridge.slice(bridge.indexOf("fun openNotificationAccess"), bridge.indexOf("fun openScreenReadingSettings"));
  assert.match(fn, /notif_consent_body/);
  assert.match(fn, /consent_not_now/);
  const activity = readFileSync("android/app/src/main/java/app/actionbrain/android/MainActivity.kt", "utf8");
  const mic = activity.slice(activity.indexOf("onPermissionRequest"), activity.indexOf("onShowFileChooser"));
  assert.ok(mic.indexOf("mic_consent_body") > -1 && mic.indexOf("mic_consent_body") < mic.indexOf("requestPermissions"), "disclosure must come before Android's prompt");
  const strings = readFileSync("android/app/src/main/res/values/strings.xml", "utf8");
  for (const name of ["notif_consent_title", "notif_consent_body", "mic_consent_title", "mic_consent_body", "consent_not_now"]) {
    assert.match(strings, new RegExp(`name="${name}"`));
  }
});

test("public privacy, terms and account-deletion pages exist outside the logged-in area", () => {
  for (const page of ["privacy", "terms", "delete-account"]) {
    const file = `src/app/${page}/page.tsx`;
    assert.ok(existsSync(file), `${file} is missing`);
    assert.doesNotMatch(readFileSync(file, "utf8"), /"use client"|supabase/, `${page} must render without a login`);
  }
  const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
  assert.match(privacy, /Limited Use/);
  assert.match(privacy, /Not end-to-end encrypted/);
  assert.match(privacy, /delete-account/);
});

test("the repository is licensed Apache-2.0 and has its governance files", () => {
  assert.match(readFileSync("LICENSE", "utf8"), /Apache License\s+Version 2\.0, January 2004/);
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).license, "Apache-2.0");
  for (const f of ["NOTICE", "SECURITY.md", "CONTRIBUTING.md"]) assert.ok(existsSync(f), `${f} is missing`);
});

test("the extension asks only for the permissions documented for the stores", () => {
  const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
  const documented = readFileSync("extension/PERMISSIONS.md", "utf8");
  for (const p of manifest.permissions) assert.match(documented, new RegExp("`" + p + "`"), `${p} has no store justification`);
  for (const h of manifest.host_permissions) assert.ok(documented.includes(h), `${h} has no store justification`);
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
});
