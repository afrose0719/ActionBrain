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
  openScreenReadingSettings: () => {},
  screenStructure: () => "",
  setNotificationsEnabled: () => {},
  setReadingMode: () => true,
  setAppEnabled: () => true,
  notificationStructure: () => "",
  pauseCapture: () => {},
  showBubbleAgain: () => {},
  addQuickSettingsTile: () => {},
  status: () => "{}",
  openNotificationAccess: () => {},
  openBatterySettings: () => {},
  openAppInfo: () => {},
});
const goodStatus = { app: true, version: "0.1.0", configured: true, listening: false, screenAvailable: true, screenOn: false, sent: 3, failed: 1, lastAt: 1790000000000, lastResult: "stored" };

// ---- the bridge object ----
test("in an ordinary browser there is no bridge", () => {
  assert.equal(getAndroidBridge({}), null);
  assert.equal(getAndroidBridge(undefined), null);
  assert.equal(getAndroidBridge({ ActionBrainAndroid: null }), null);
  assert.equal(getAndroidBridge({ ActionBrainAndroid: "yes" }), null);
});

const CORE = ["isApp", "saveIntake", "clearIntake", "status", "openNotificationAccess", "openBatterySettings", "openAppInfo"];

test("the bridge is recognised only when every core method is there", () => {
  const bridge = fullBridge();
  assert.equal(getAndroidBridge({ ActionBrainAndroid: bridge }), bridge);
  for (const name of CORE) {
    const partial: Record<string, unknown> = { ...bridge };
    delete partial[name];
    assert.equal(getAndroidBridge({ ActionBrainAndroid: partial }), null, `missing ${name}`);
    assert.equal(getAndroidBridge({ ActionBrainAndroid: { ...bridge, [name]: "not a function" } }), null, `${name} not a function`);
  }
});

test("an older app without the newer methods is still recognised as the app", () => {
  const older: Record<string, unknown> = {};
  for (const name of CORE) older[name] = () => {};
  assert.equal(getAndroidBridge({ ActionBrainAndroid: older }), older);
});

// ---- the status text ----
test("a good status is read", () => {
  assert.deepEqual(parseAndroidStatus(JSON.stringify(goodStatus)), {
    version: "0.1.0",
    configured: true,
    listening: false,
    screenAvailable: true,
    screenOn: false,
    sent: 3,
    failed: 1,
    lastAt: 1790000000000,
    lastResult: "stored",
    controls: null, // this status came from an app too old to have capture controls
  });
});

const goodControls = { notificationsOn: true, readingMode: "tap", pausedUntil: 0, bubbleHidden: false };

test("the capture controls are read when the app sends them", () => {
  const s = parseAndroidStatus(JSON.stringify({ ...goodStatus, ...goodControls, pausedUntil: 1790000999000.7, bubbleHidden: true, notificationsOn: false }));
  assert.deepEqual(s?.controls, {
    notificationsOn: false,
    readingMode: "tap",
    pausedUntil: 1790000999000,
    bubbleHidden: true,
    apps: { whatsapp: true, teams: false }, // an app that does not say: WhatsApp on, Teams off
  });
  for (const mode of ["off", "auto", "tap"]) assert.equal(parseAndroidStatus(JSON.stringify({ ...goodStatus, ...goodControls, readingMode: mode }))?.controls?.readingMode, mode);
});

test("which chat apps are switched on is read, and a wrong shape is refused", () => {
  const apps = { whatsapp: false, teams: true };
  assert.deepEqual(parseAndroidStatus(JSON.stringify({ ...goodStatus, ...goodControls, apps }))?.controls?.apps, apps);
  for (const bad of [{ whatsapp: true }, { whatsapp: "yes", teams: false }, { whatsapp: true, teams: 1 }, null, "teams", []]) {
    assert.equal(parseAndroidStatus(JSON.stringify({ ...goodStatus, ...goodControls, apps: bad })), null, JSON.stringify(bad));
  }
});

test("capture controls that are present but wrong are refused, never half-read", () => {
  for (const bad of [
    { readingMode: "always" },
    { readingMode: "AUTO" },
    { readingMode: 1 },
    { readingMode: null },
    { notificationsOn: "yes" },
    { notificationsOn: undefined },
    { pausedUntil: -1 },
    { pausedUntil: "0" },
    { pausedUntil: null },
    { bubbleHidden: 1 },
  ]) {
    assert.equal(parseAndroidStatus(JSON.stringify({ ...goodStatus, ...goodControls, ...bad })), null, JSON.stringify(bad));
  }
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
    JSON.stringify({ ...goodStatus, screenAvailable: "yes" }),
    JSON.stringify({ ...goodStatus, screenOn: 1 }),
    JSON.stringify({ ...goodStatus, sent: -1 }),
    JSON.stringify({ ...goodStatus, failed: "2" }),
    JSON.stringify({ ...goodStatus, lastAt: null }),
    JSON.stringify({ ...goodStatus, lastResult: null }),
  ];
  for (const input of bad) assert.equal(parseAndroidStatus(input), null, String(input));
});

test("an older app (before 0.3.0) that does not send the live-reading fields still works, as 'not available'", () => {
  const older: Record<string, unknown> = { ...goodStatus };
  delete older.screenAvailable;
  delete older.screenOn;
  const s = parseAndroidStatus(JSON.stringify(older));
  assert.equal(s?.screenAvailable, false);
  assert.equal(s?.screenOn, false);
  assert.equal(s?.sent, 3);
});

test("the page tells you when the installed app has no live chat reading", () => {
  const panel = readFileSync(new URL("../src/components/phone-intake.tsx", import.meta.url), "utf8");
  assert.ok(panel.includes("!phone.screenAvailable"));
  assert.ok(panel.includes("is not in this version of the app"));
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
  assert.ok(inbox.includes("takeSharedFile?.()"));
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
  assert.deepEqual(exposed, ["addQuickSettingsTile", "clearIntake", "isApp", "notificationStructure", "openAppInfo", "openBatterySettings", "openNotificationAccess", "openScreenReadingSettings", "pauseCapture", "saveIntake", "screenStructure", "setAppEnabled", "setNotificationsEnabled", "setReadingMode", "showBubbleAgain", "status", "takeSharedFile"]);
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

test("only the supported chat apps' notifications are read, and only the ones switched on", () => {
  const apps = read("android/app/src/main/java/app/actionbrain/android/ChatApps.kt");
  const packages = [...apps.matchAll(/packages = setOf\(([^)]*)\)/g)].flatMap((m) => m[1].split(",").map((p) => p.trim().replace(/"/g, "")));
  assert.deepEqual(packages, ["com.whatsapp", "com.whatsapp.w4b", "com.microsoft.teams"]);
  assert.ok(listener.includes("ChatApps.forPackage(sbn.packageName) ?: return"));
  assert.ok(listener.includes("policy.appActive(app.source)"));
  // the app check comes before anything is read or sent
  assert.ok(listener.indexOf("appActive") < listener.indexOf("IntakeClient.send"));
});

test("the website the app opens is the deployed one, and the app keeps to that one site", () => {
  assert.ok(read("android/gradle.properties").includes("actionbrainUrl=https://action-brain-sigma.vercel.app"));
  const activity = read("android/app/src/main/java/app/actionbrain/android/MainActivity.kt");
  assert.ok(activity.includes('uri.scheme == "https" && uri.host == appHost'));
  assert.ok(activity.includes("request.origin.host != appHost"));
});

// ---- live chat reading (the optional Accessibility service) ----
const fullManifest = read("android/app/src/full/AndroidManifest.xml");
const serviceConfig = read("android/app/src/full/res/xml/screen_service_config.xml");
const screenService = read("android/app/src/full/java/app/actionbrain/android/WhatsAppScreenService.kt");

test("live chat reading exists only in the 'full' build, never in the main manifest the Play build uses", () => {
  assert.ok(!manifest.includes("ACCESSIBILITY"), "main manifest must not mention accessibility");
  assert.ok(fullManifest.includes('android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"'));
  assert.ok(gradle.includes('create("full")') && gradle.includes('create("play")'));
  assert.ok(gradle.includes('buildConfigField("boolean", "SCREEN_READING", "true")'));
  assert.ok(gradle.includes('buildConfigField("boolean", "SCREEN_READING", "false")'));
});

test("the service is read-only and scoped to the supported chat apps, by Android's own configuration", () => {
  assert.ok(serviceConfig.includes('android:packageNames="com.whatsapp,com.whatsapp.w4b,com.microsoft.teams"'));
  assert.ok(serviceConfig.includes('android:canRetrieveWindowContent="true"'));
  for (const power of ["canPerformGestures", "canTakeScreenshot", "flagRequestTouchExplorationMode", "typeViewTextChanged", "typeAllMask", "canRequestFilterKeyEvents", "flagRequestFilterKeyEvents", "typeViewClicked"]) {
    assert.ok(!serviceConfig.replace(/<!--[\s\S]*?-->/g, "").includes(power), `must not use ${power}`);
  }
});

test("the service reads message text only for the three named parts of the app in front, and never acts on the screen", () => {
  assert.ok(screenService.includes("val wanted = app.ids.wanted(id)"));
  const apps = read("android/app/src/main/java/app/actionbrain/android/ChatApps.kt");
  const wanted = apps.slice(apps.indexOf("fun wanted("), apps.indexOf("private fun matches"));
  for (const list of ["chatName", "messageText", "groupMember"]) assert.ok(wanted.includes(`name in ${list}`), list);
  assert.ok(!/name in (?!chatName|messageText|groupMember)/.test(wanted), "only those three kinds of part");
  for (const action of ["performAction", "dispatchGesture", "ACTION_CLICK", "ACTION_SET_TEXT", "performGlobalAction", "takeScreenshot"]) {
    assert.ok(!screenService.includes(action), `must not call ${action}`);
  }
  // an app is read only if it is one we support AND the user switched it on
  assert.ok(screenService.includes("policy.appActive(app.source)"));
});

test("the consent dialog is native, comes before Android's settings open, and says what is read and what happens to it", () => {
  assert.ok(kotlinBridge.includes("AlertDialog.Builder(activity)"));
  const open = kotlinBridge.slice(kotlinBridge.indexOf("fun openScreenReadingSettings"));
  assert.ok(open.indexOf("AlertDialog.Builder") < open.indexOf("ACTION_ACCESSIBILITY_SETTINGS"));
  assert.ok(open.includes("setPositiveButton") && open.includes("setNegativeButton"));
  const strings = read("android/app/src/main/res/values/strings.xml");
  for (const phrase of ["What it reads", "does not read what you type", "your own ActionBrain account", "have not agreed", "switch it off at any time"]) {
    assert.ok(strings.includes(phrase), phrase);
  }
});

test("the website only offers live chat reading when the app says it has it", () => {
  const panel = read("src/components/phone-intake.tsx");
  assert.ok(panel.includes("phone.screenAvailable && !phone.screenOn"));
  assert.ok(panel.includes("openScreenReadingSettings?.()"));
});

// ---- capture modes, the floating button, the pause and the tile ----
const policy = read("android/app/src/main/java/app/actionbrain/android/CaptureSettings.kt");
const listener = read("android/app/src/main/java/app/actionbrain/android/WhatsAppListenerService.kt");
const tile = read("android/app/src/main/java/app/actionbrain/android/CaptureTileService.kt");
const bubble = read("android/app/src/full/java/app/actionbrain/android/Bubble.kt");

test("the app refuses any reading mode that is not off, auto or tap", () => {
  assert.ok(policy.includes('const val OFF = "off"') && policy.includes('const val AUTO = "auto"') && policy.includes('const val TAP = "tap"'));
  assert.ok(kotlinBridge.includes("fun setReadingMode(mode: String?): Boolean = CaptureSettings(activity).setReading(mode)"));
  assert.ok(policy.includes("CaptureMode.parse(mode) ?: return false"));
});

test("the notification service obeys the switch and the pause", () => {
  assert.ok(listener.includes("notificationsActive(System.currentTimeMillis())"));
  // the check comes before anything is read or sent
  assert.ok(listener.indexOf("notificationsActive") < listener.indexOf("IntakeClient.send"));
});

test("automatic reading happens only in auto mode; tap mode reads only when the button is tapped", () => {
  assert.ok(screenService.includes("readingMode(now) == CaptureMode.AUTO) autoRead()"));
  assert.equal((screenService.match(/\.read\(node/g) ?? []).length, 1, "reading happens in one place only");
  assert.equal((screenService.match(/\.captureVisible\(node/g) ?? []).length, 1);
  assert.ok(screenService.indexOf("fun captureNow") < screenService.indexOf(".captureVisible(node"));
  assert.ok(screenService.includes("readingMode(now) != CaptureMode.TAP) return removeBubble()"));
});

test("the floating button needs no extra permission: it is an accessibility overlay", () => {
  assert.ok(bubble.includes("TYPE_ACCESSIBILITY_OVERLAY"));
  assert.ok(bubble.includes("FLAG_NOT_FOCUSABLE"));
  for (const file of [manifest, fullManifest, bubble, screenService]) {
    assert.ok(!file.includes("SYSTEM_ALERT_WINDOW"), "must not ask for 'display over other apps'");
    assert.ok(!file.includes("TYPE_APPLICATION_OVERLAY"));
  }
});

test("the floating button can be reached by TalkBack and moved without blocking the keyboard", () => {
  assert.ok(bubble.includes("contentDescription"));
  assert.ok(bubble.includes("setOnClickListener"));
  assert.ok(bubble.includes("performClick()"));
});

test("the Quick Settings tile only changes the pause time, and is protected by the system permission", () => {
  assert.ok(manifest.includes('android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"'));
  assert.ok(manifest.includes("android.service.quicksettings.action.QS_TILE"));
  assert.ok(tile.includes("pauseFor("));
  assert.ok(!tile.includes("setReading") && !tile.includes("setNotifications"));
  // the tile is not a permission request: the manifest still lists only the two permissions
  const perms = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(perms, ["android.permission.INTERNET", "android.permission.RECORD_AUDIO"]);
});

test("the settings panel offers the controls only to an app that has them", () => {
  const panel = read("src/components/phone-intake.tsx");
  assert.ok(panel.includes("phone.controls && ("));
  assert.ok(panel.includes('role="radiogroup"'));
  for (const call of ["setNotificationsEnabled?.(", "setReadingMode?.(", "pauseCapture?.(", "showBubbleAgain?.(", "addQuickSettingsTile?.("]) {
    assert.ok(panel.includes(call), call);
  }
  assert.ok(!panel.includes("Date.now()") || !panel.includes("pausedUntil > Date.now()"), "the page must not read the clock while rendering");
});

test("every reading mode the page offers is one the app accepts", () => {
  const panel = read("src/components/phone-intake.tsx");
  const offered = [...panel.matchAll(/\{ mode: "(\w+)", label:/g)].map((m) => m[1]).sort();
  assert.deepEqual(offered, ["auto", "off", "tap"]);
});

// ---- Microsoft Teams on the phone ----
test("Teams is off until the user chooses it, and choosing it shows the app's own agreement first", () => {
  assert.ok(policy.includes('val apps: Set<String> = setOf("whatsapp")'));
  assert.ok(kotlinBridge.includes('app.source == "teams" && !settings.teamsConsented()'));
  const strings = read("android/app/src/main/res/values/strings.xml");
  for (const phrase of ["Capture Microsoft Teams messages?", "have not agreed", "Check that your organisation allows it", "switch Teams off at any time", "your own ActionBrain account"]) {
    assert.ok(strings.includes(phrase), phrase);
  }
});

test("a message from Teams is sent with its source, so the server files it as Teams", () => {
  assert.ok(listener.includes("Payload.message(message.sender, message.text, message.group, false, app.source)"));
  assert.ok(screenService.includes("m.mine, app.source"));
  assert.ok(kotlinPayload.includes('if (source != "whatsapp") parts += "\\"source\\":"'));
});

test("the settings page offers the app switches only to an app that has them", () => {
  const panel = read("src/components/phone-intake.tsx");
  assert.ok(panel.includes("bridge.setAppEnabled && ("));
  assert.ok(panel.includes("setAppEnabled?.(choice.source, e.target.checked)"));
  const offered = [...panel.matchAll(/source: "(\w+)",\s*label/g)].map((m) => m[1]).sort();
  assert.deepEqual(offered, ["teams", "whatsapp"]);
});
