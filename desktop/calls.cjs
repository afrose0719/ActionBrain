// ActionBrain desktop helper: knows when a WhatsApp or Teams call is going on, WITHOUT touching WhatsApp or Teams.
// Windows records, for privacy, which app is using the microphone right now (the same list behind Settings > Privacy >
// Microphone and the microphone icon in the taskbar). An app whose "LastUsedTimeStop" is 0 is using the microphone at this moment.
// A call app using the microphone = a call is on. Pure functions here; main.cjs runs `reg query` and acts on the result.

"use strict";

const MIC_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";

/** The call apps we recognise, by Store package name or program path (Windows writes paths with # instead of \). */
const APPS = [
  { id: "whatsapp", label: "WhatsApp", match: /(^|\\)(5319275A\.WhatsAppDesktop_|[^\\]*#WhatsApp[^\\]*\.exe$)/i },
  { id: "teams", label: "Microsoft Teams", match: /(^|\\)(MSTeams_|[^\\]*#(ms-teams|Teams)\.exe$)/i },
  { id: "zoom", label: "Zoom", match: /(^|\\)(ZoomVideoCommunications[^\\]*|[^\\]*#Zoom\.exe)$/i },
  { id: "slack", label: "Slack", match: /(^|\\)(91750D7E\.Slack_[^\\]*|[^\\]*#slack\.exe)$/i },
  // Google Meet, WhatsApp Web and other calls in a browser. A browser can also use the microphone for other things (voice typing),
  // so this one is only on if the person ticks it; anything under 15 seconds is thrown away anyway. Checked last.
  { id: "browser", label: "Google Meet / browser", match: /(^|\\)[^\\]*#(chrome|msedge|firefox|brave|opera|vivaldi)\.exe$/i },
];

/** Which apps are watched when nothing is saved yet. */
const DEFAULT_APPS = { whatsapp: true, teams: true, zoom: true, slack: true, browser: false };

/**
 * Reads the text of `reg query <MIC_KEY> /s` and returns each sub-key with its start/stop values.
 * Values are REG_QWORD in hexadecimal; a missing value is null.
 */
function parseRegQuery(text) {
  const entries = [];
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^HKEY_/i.test(line)) {
      current = { key: line.trim(), start: null, stop: null };
      entries.push(current);
      continue;
    }
    const m = /^\s+(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+0x([0-9a-f]+)\s*$/i.exec(line);
    if (m && current) current[m[1] === "LastUsedTimeStart" ? "start" : "stop"] = BigInt("0x" + m[2]);
  }
  return entries;
}

/** Which call app is using the microphone right now ("whatsapp", "teams"), or null. Our own helper is never counted. */
/** @param {{key: string, start: bigint | null, stop: bigint | null}[]} entries @param {Partial<Record<string, boolean>>} [enabled] */
function activeCallApp(entries, enabled = DEFAULT_APPS) {
  for (const e of entries) {
    const inUse = e.start !== null && e.start > 0n && e.stop === 0n;
    if (!inUse) continue;
    const name = e.key.slice(e.key.lastIndexOf("\\") + 1);
    if (/ActionBrain/i.test(name)) continue;
    for (const app of APPS) if (enabled[app.id] && app.match.test(name)) return app.id;
  }
  return null;
}

const labelOf = (id) => (APPS.find((a) => a.id === id) || { label: id }).label;

/**
 * The helper's state machine. Small blips (an app briefly releasing the microphone) must not split one call into two, so a call
 * only counts as ended after `endAfterMs` without the microphone. Calls shorter than `minMs` (a voice note, a mic test) are dropped.
 *
 * state: { phase: "idle" } | { phase: "call", app, since, lastSeen }
 * returns { state, action } where action is null | { type: "start", app } | { type: "finish", app, ms } | { type: "drop", app, ms }
 */
function step(state, app, now, { endAfterMs = 4000, minMs = 15000 } = {}) {
  if (state.phase === "idle") {
    if (app) return { state: { phase: "call", app, since: now, lastSeen: now }, action: { type: "start", app } };
    return { state, action: null };
  }
  if (app === state.app) return { state: { ...state, lastSeen: now }, action: null };
  if (now - state.lastSeen < endAfterMs) return { state, action: null }; // still within the grace period
  const ms = state.lastSeen - state.since;
  return { state: { phase: "idle" }, action: { type: ms >= minMs ? "finish" : "drop", app: state.app, ms } };
}

module.exports = { MIC_KEY, APPS, DEFAULT_APPS, parseRegQuery, activeCallApp, labelOf, step };
