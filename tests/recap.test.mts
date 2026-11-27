import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRecap } from "../src/lib/recap.ts";

// Milestone 32: after-call voice recap. The page can be opened by any link, so every value is checked.

test("a recap link from the app is read", () => {
  assert.deepEqual(parseRecap("?recap=Priya%20Raman&via=WhatsApp&mins=4"), { name: "Priya Raman", via: "WhatsApp", mins: 4 });
  assert.deepEqual(parseRecap("?recap=Anish&via=Microsoft%20Teams&mins=12"), { name: "Anish", via: "Microsoft Teams", mins: 12 });
});

test("anything unexpected is refused", () => {
  for (const q of ["", "?recap=&via=WhatsApp&mins=4", "?recap=Priya&via=Evil&mins=4", "?recap=Priya&via=WhatsApp&mins=0", "?recap=Priya&via=WhatsApp&mins=abc", "?recap=Priya&via=WhatsApp&mins=9999"]) {
    assert.equal(parseRecap(q), null, q);
  }
  assert.equal(parseRecap("?recap=%3Cscript%3EPriya&via=WhatsApp&mins=4")?.name, "scriptPriya", "angle brackets removed");
  assert.equal(parseRecap(`?recap=${"x".repeat(200)}&via=WhatsApp&mins=4`)?.name.length, 80);
});

test("the recap is the owner's own voice: no consent checkbox, saved with the caller as attendee", () => {
  const recorder = readFileSync("src/components/call-recorder.tsx", "utf8");
  assert.ok(recorder.includes("useState(Boolean(recapOf))") && recorder.includes("Only your own voice is recorded"));
  const page = readFileSync("src/app/(app)/meetings/page.tsx", "utf8");
  assert.ok(page.includes("attendees: recap ? recap.name : null"));
});

test("Android: only answered calls, opt-in, own explanation before the notification permission, safe link", () => {
  const kt = (f: string) => readFileSync(`android/app/src/main/java/app/actionbrain/android/${f}`, "utf8");
  assert.ok(kt("CallRecap.kt").includes("if (!isCall || !ongoing || !showsTimer) return"));
  assert.ok(kt("CaptureSettings.kt").includes('callRecap = prefs.getBoolean("call_recap", false)'), "off by default");
  const bridge = kt("WebBridge.kt");
  const fn = bridge.slice(bridge.indexOf("fun setCallRecap"), bridge.indexOf("private fun notificationsAllowed"));
  assert.ok(fn.indexOf("recap_consent_body") < fn.indexOf("POST_NOTIFICATIONS"), "explanation before Android's prompt");
  assert.ok(kt("CallRecap.kt").includes('val prefix = appUrl.trimEnd(\'/\') + "/meetings?recap="'), "the app only opens its own recap page");
  assert.ok(kt("MainActivity.kt").includes("RecapIntent.safeUrl(BuildConfig.APP_URL"));
});
