import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import calls from "../desktop/calls.cjs";

const { parseRegQuery, activeCallApp, step } = calls;

const K = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";
// shaped exactly like `reg query <key> /s` on Windows 11 (copied from a real laptop, values changed)
const reg = (teamsStop: string, waStop: string) => `
${K}
    Value    REG_SZ    Allow

${K}\\MSTeams_8wekyb3d8bbwe
    Value    REG_SZ    Allow
    LastSetTime    REG_QWORD    0x1dd34771388b131
    LastUsedTimeStart    REG_QWORD    0x1dd62d81847aae8
    LastUsedTimeStop    REG_QWORD    ${teamsStop}

${K}\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm
    LastUsedTimeStart    REG_QWORD    0x1dd62d81847aae8
    LastUsedTimeStop    REG_QWORD    ${waStop}

${K}\\NonPackaged
    Value    REG_SZ    Allow

${K}\\NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe
    LastUsedTimeStart    REG_QWORD    0x1dd62c152a6ec0e
    LastUserAnnotatedLabel    REG_DWORD    0x2
    LastUsedTimeStop    REG_QWORD    0x0
`;

test("reads the start/stop times of every app from reg query output", () => {
  const entries = parseRegQuery(reg("0x1dd62e0000000000", "0x1dd62e0000000000").replace(/\n/g, "\r\n"));
  const teams = entries.find((e) => e.key.endsWith("MSTeams_8wekyb3d8bbwe"));
  assert.equal(teams?.start, BigInt("0x1dd62d81847aae8"));
  assert.equal(teams?.stop, BigInt("0x1dd62e0000000000"));
  assert.equal(entries.find((e) => e.key.endsWith("\\NonPackaged"))?.start, null);
});

test("a call app with the microphone open right now (stop = 0) is a call", () => {
  assert.equal(activeCallApp(parseRegQuery(reg("0x0", "0x1dd62e0000000000"))), "teams");
  assert.equal(activeCallApp(parseRegQuery(reg("0x1dd62e0000000000", "0x0"))), "whatsapp");
});

test("other apps using the microphone (a browser) are not a call; nothing open = no call", () => {
  assert.equal(activeCallApp(parseRegQuery(reg("0x1dd62e0000000000", "0x1dd62e0000000000"))), null);
});

test("an app switched off in the helper is ignored", () => {
  assert.equal(activeCallApp(parseRegQuery(reg("0x0", "0x1dd62e0000000000")), { whatsapp: true, teams: false }), null);
});

test("classic programs are recognised by path; ActionBrain itself never counts", () => {
  const np = (path: string) => `${K}\\NonPackaged\\${path}\n    LastUsedTimeStart    REG_QWORD    0x1\n    LastUsedTimeStop    REG_QWORD    0x0\n`;
  assert.equal(activeCallApp(parseRegQuery(np("C:#Users#me#AppData#Local#WhatsApp#WhatsApp.exe"))), "whatsapp");
  assert.equal(activeCallApp(parseRegQuery(np("C:#Users#me#AppData#Local#Microsoft#Teams#current#Teams.exe"))), "teams");
  assert.equal(activeCallApp(parseRegQuery(np("C:#Users#me#AppData#Local#Programs#ActionBrain Teams Helper#ActionBrain.exe"))), null);
  assert.equal(activeCallApp(parseRegQuery(np("C:#Tools#NotWhatsAppish#recorder.exe"))), null);
});

test("state machine: a call starts, short blips are ignored, and it finishes after the grace period", () => {
  let s: ReturnType<typeof step>["state"] = { phase: "idle" };
  let r = step(s, "teams", 0);
  assert.deepEqual(r.action, { type: "start", app: "teams" });
  s = r.state;
  s = step(s, "teams", 10_000).state;
  r = step(s, null, 12_000); // the microphone blinked off for 2 s: not the end
  assert.equal(r.action, null);
  s = step(r.state, "teams", 23_000).state;
  r = step(s, null, 26_000);
  assert.equal(r.action, null);
  r = step(r.state, null, 27_500); // 4.5 s without the microphone: the call is over
  assert.deepEqual(r.action, { type: "finish", app: "teams", ms: 23_000 });
  assert.deepEqual(r.state, { phase: "idle" });
});

test("state machine: a voice note or mic test (under 15 s) is dropped, not transcribed", () => {
  let r = step({ phase: "idle" }, "whatsapp", 0);
  r = step(r.state, "whatsapp", 6_000);
  r = step(r.state, null, 11_000);
  assert.deepEqual(r.action, { type: "drop", app: "whatsapp", ms: 6_000 });
});

test("Zoom, Slack and browser calls are recognised; browser calls only when switched on", () => {
  const np = (path: string) => `${K}\\NonPackaged\\${path}\n    LastUsedTimeStart    REG_QWORD    0x1\n    LastUsedTimeStop    REG_QWORD    0x0\n`;
  assert.equal(activeCallApp(parseRegQuery(np("C:#Users#me#AppData#Roaming#Zoom#bin#Zoom.exe"))), "zoom");
  assert.equal(activeCallApp(parseRegQuery(np("C:#Users#me#AppData#Local#slack#app-4.41.0#slack.exe"))), "slack");
  const chrome = parseRegQuery(np("C:#Program Files#Google#Chrome#Application#chrome.exe"));
  assert.equal(activeCallApp(chrome), null, "off by default");
  assert.equal(activeCallApp(chrome, { browser: true }), "browser");
  assert.equal(activeCallApp(parseRegQuery(np("C:#Program Files (x86)#Microsoft#Edge#Application#msedge.exe")), { browser: true }), "browser");
});

test("every helper label is accepted by the website (and nothing else)", () => {
  const site = readFileSync("src/lib/desktop-bridge.ts", "utf8");
  for (const app of calls.APPS) assert.ok(site.includes(`"${app.label}"`), app.label);
});
