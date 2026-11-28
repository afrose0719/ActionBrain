// What the ActionBrain website can use inside the desktop helper: window.ActionBrainDesktop.
// Only on the ActionBrain site itself, and only these three things: hear that the call ended or was skipped, and report progress.
"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const origin = ipcRenderer.sendSync("origin"); // the one site this helper opens

if (origin && window.location.origin === origin) {
  contextBridge.exposeInMainWorld("ActionBrainDesktop", {
    isDesktop: true,
    /** The call app let go of the microphone: stop and transcribe. */
    onCallEnded: (fn) => ipcRenderer.on("call-ended", () => fn()),
    /** The person skipped this call, or it was only a few seconds (a voice note): throw the recording away. */
    onCallCancelled: (fn) => ipcRenderer.on("call-cancel", () => fn()),
    /** "recording" | "transcribing" | "saved" | "error", with a short message for errors. */
    report: (state, detail) => ipcRenderer.send("status", String(state).slice(0, 20), String(detail || "").slice(0, 300)),
  });
}
