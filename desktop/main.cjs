// ActionBrain Call Notes: a small Windows helper that takes notes on WhatsApp Desktop and Microsoft Teams calls by itself.
//
// How it works (nothing here touches WhatsApp or Teams):
// 1. Every 2 seconds it asks Windows which app is using the microphone (calls.cjs). A call app using it = a call is on.
// 2. It then opens the ordinary ActionBrain Meetings page in a hidden window, which records this computer's sound (the other
//    people) and the microphone (you), exactly like the "On this computer" option in Chrome, but without the share prompt.
// 3. When the call app lets go of the microphone, the page turns the audio into text ON THIS COMPUTER, saves only the text to the
//    user's own ActionBrain account, and suggests tasks. The audio is never uploaded or saved.
// The person agrees to this once, sees a notification on every call (with "skip this call"), and can pause it from the tray.

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
} = require("electron");
const calls = require("./calls.cjs");

const APP_URL = (process.env.ACTIONBRAIN_URL || "https://action-brain-sigma.vercel.app").replace(/\/+$/, "");
const ORIGIN = new URL(APP_URL).origin;
const POLL_MS = 2000;
const START_TIMEOUT_MS = 30_000; // the page must report "recording" within this time, or the person is told why
const FINISH_TIMEOUT_MS = 30 * 60_000; // transcribing a long call can take a while, but not forever

// For development only: a separate profile and a DevTools port, so the helper can be tested without touching a real install.
if (process.env.ACTIONBRAIN_USER_DATA) app.setPath("userData", process.env.ACTIONBRAIN_USER_DATA);
if (process.env.ACTIONBRAIN_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.ACTIONBRAIN_DEBUG_PORT);

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("app.actionbrain.desktop");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required"); // audio must start without a click
app.commandLine.appendSwitch("disable-renderer-backgrounding"); // the hidden recording window must not be slowed down

// ---------------- settings ----------------

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const defaults = { consented: false, paused: false, apps: { ...calls.DEFAULT_APPS } };
let settings = { ...defaults };
function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    settings = { ...defaults, ...saved, apps: { ...defaults.apps, ...(saved.apps || {}) } };
  } catch {
    settings = { ...defaults };
  }
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {
    /* not critical */
  }
}

// ---------------- windows ----------------

const sameOrigin = (url) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};

const webPreferences = () => ({
  preload: path.join(__dirname, "preload.cjs"),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  backgroundThrottling: false,
});

/** Only the ActionBrain website opens inside the app; any other link opens in the normal browser. */
function lockToSite(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!sameOrigin(url)) {
      event.preventDefault();
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    }
  });
}

let mainWindow = null;
function showMain(pathname = "/meetings") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({ width: 1180, height: 820, title: "ActionBrain", icon: iconPath(), webPreferences: webPreferences() });
  mainWindow.removeMenu();
  lockToSite(mainWindow);
  mainWindow.loadURL(APP_URL + pathname);
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault(); // closing the window keeps the helper running in the tray
      mainWindow.hide();
    }
  });
}

// ---------------- one recording per call ----------------

/** @type {Map<number, {win: BrowserWindow, app: string, state: string, timer: NodeJS.Timeout | null}>} */
const recordings = new Map();
let current = null; // the recording of the call that is going on now (its webContents id), or null
let skipped = false; // the person chose "skip this call"

function startRecording(appId) {
  const label = calls.labelOf(appId);
  const win = new BrowserWindow({ show: false, width: 900, height: 700, icon: iconPath(), webPreferences: webPreferences() });
  lockToSite(win);
  const id = win.webContents.id;
  const rec = { win, app: appId, state: "starting", timer: null };
  recordings.set(id, rec);
  current = id;
  rec.timer = setTimeout(() => {
    if (rec.state === "starting") {
      notify("Call notes could not start", "Open ActionBrain and check that you are signed in.", () => showMain());
      closeRecording(id);
    }
  }, START_TIMEOUT_MS);
  win.loadURL(APP_URL + "/meetings?desktop=call&via=" + encodeURIComponent(label));

  notify(
    `Taking notes on your ${label} call`,
    "Tell the other people that ActionBrain is taking notes. Click here to skip this call.",
    () => {
      skipped = true;
      send(id, "call-cancel");
      closeRecording(id);
      updateTray();
    }
  );
  updateTray();
}

function send(id, channel) {
  const rec = recordings.get(id);
  if (rec && !rec.win.isDestroyed()) rec.win.webContents.send(channel);
}

function closeRecording(id) {
  const rec = recordings.get(id);
  if (!rec) return;
  if (rec.timer) clearTimeout(rec.timer);
  recordings.delete(id);
  if (current === id) current = null;
  if (!rec.win.isDestroyed()) rec.win.destroy();
  updateTray();
}

ipcMain.on("origin", (event) => {
  event.returnValue = ORIGIN;
});

// The page in a recording window reports what it is doing.
ipcMain.on("status", (event, state, detail) => {
  const id = event.sender.id;
  const rec = recordings.get(id);
  if (!rec || !sameOrigin(event.senderFrame?.url || "")) return;
  rec.state = String(state);
  if (state === "transcribing" && rec.timer) {
    clearTimeout(rec.timer);
    rec.timer = setTimeout(() => closeRecording(id), FINISH_TIMEOUT_MS);
  }
  if (state === "recording" && rec.timer) {
    clearTimeout(rec.timer);
    rec.timer = null;
  }
  if (state === "saved") {
    notify("Call notes saved", `Your ${calls.labelOf(rec.app)} call is in Meetings with suggested tasks to review.`, () => showMain());
    setTimeout(() => closeRecording(id), 1500);
  }
  if (state === "error") {
    notify("Call notes failed", String(detail || "Something went wrong.").slice(0, 200), () => showMain());
    closeRecording(id);
  }
  updateTray();
});

// ---------------- watching for calls ----------------

let callState = { phase: "idle" };
function poll() {
  execFile("reg", ["query", calls.MIC_KEY, "/s"], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
    if (err && !stdout) return;
    const active = settings.paused ? null : calls.activeCallApp(calls.parseRegQuery(stdout), settings.apps);
    const { state, action } = calls.step(callState, active, Date.now());
    callState = state;
    if (!action) return;
    if (action.type === "start") {
      skipped = false;
      startRecording(action.app);
    } else if (current !== null) {
      const id = current;
      current = null;
      if (skipped || action.type === "drop") {
        send(id, "call-cancel");
        closeRecording(id);
      } else {
        send(id, "call-ended"); // the page stops, transcribes on this computer, saves, then reports "saved"
      }
    }
    updateTray();
  });
}

// ---------------- the browser permissions the page needs ----------------

function allowSiteOnly() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(["media", "display-capture", "notifications", "clipboard-sanitized-write"].includes(permission) && sameOrigin(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => ["media", "display-capture"].includes(permission) && sameOrigin(origin));
  // The page asks for the screen + system audio; answer with this computer's sound (Windows loopback) and no picker.
  // Only the sound is used: the page stops the picture at once.
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!sameOrigin(request.frame?.url || "")) return callback({});
    const sources = await desktopCapturer.getSources({ types: ["screen"] }).catch(() => []);
    if (sources.length === 0) return callback({});
    callback({ video: sources[0], audio: "loopback" });
  });
}

// ---------------- tray ----------------

function iconPath() {
  return path.join(__dirname, "icon.png");
}

let tray = null;
function statusText() {
  if (settings.paused) return "Paused: calls are not recorded";
  const rec = current !== null ? recordings.get(current) : null;
  if (rec) return `Taking notes: ${calls.labelOf(rec.app)} call`;
  const busy = [...recordings.values()].some((r) => r.state === "transcribing");
  if (busy) return "Turning the last call into notes...";
  return "Waiting for WhatsApp or Teams calls";
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip("ActionBrain Call Notes\n" + statusText());
  const toggle = (key) => () => {
    settings.apps[key] = !settings.apps[key];
    saveSettings();
    updateTray();
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: statusText(), enabled: false },
      { type: "separator" },
      { label: "Open ActionBrain", click: () => showMain() },
      { type: "separator" },
      ...calls.APPS.map((a) => ({
        label: a.id === "browser" ? "Take notes on browser calls (Google Meet, WhatsApp Web)" : `Take notes on ${a.label} calls`,
        type: "checkbox",
        checked: Boolean(settings.apps[a.id]),
        click: toggle(a.id),
      })),
      {
        label: "Pause",
        type: "checkbox",
        checked: settings.paused,
        click: () => {
          settings.paused = !settings.paused;
          saveSettings();
          updateTray();
        },
      },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
          updateTray();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => quit() },
    ])
  );
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath() });
  if (onClick) n.on("click", onClick);
  n.show();
}

// ---------------- start-up ----------------

let quitting = false;
function quit() {
  quitting = true;
  for (const id of [...recordings.keys()]) closeRecording(id);
  app.quit();
}

/** Prominent disclosure, shown by the helper itself before anything is recorded. */
async function askConsent() {
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: "question",
    title: "ActionBrain Call Notes",
    message: "Take notes on your calls automatically?",
    detail:
      "When WhatsApp, Microsoft Teams, Zoom or Slack starts using your microphone (a call), ActionBrain records this computer's sound " +
      "(the other people) and your microphone until the call ends.\n\n" +
      "The audio is turned into text on this computer and then thrown away; it is never uploaded or saved. Only the text is saved " +
      "to your own ActionBrain account, where tasks are suggested for you to review.\n\n" +
      "You see a notification on every call and can skip that call. Pause or quit at any time from the tray icon.\n\n" +
      "The other people on the call have not agreed to this. Tell them at the start (\"I'm using ActionBrain to note action items, OK?\") " +
      "and follow the recording laws where you and they are.\n\n" +
      "ActionBrain does not join the call and does not control WhatsApp or Teams. It starts with Windows; change that in the tray menu.",
    buttons: ["Agree and start", "Quit"],
    checkboxLabel: "Also browser calls (Google Meet, WhatsApp Web). A website using the microphone for anything else would be recorded too.",
    checkboxChecked: true,
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  return { agreed: response === 0, browser: checkboxChecked };
}

app.on("second-instance", () => showMain());
app.on("window-all-closed", () => {
  /* keep running in the tray */
});

app.whenReady().then(async () => {
  loadSettings();
  allowSiteOnly();
  if (!settings.consented) {
    const answer = await askConsent();
    if (!answer.agreed) return quit();
    settings.consented = true;
    settings.apps.browser = answer.browser;
    saveSettings();
    app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
    showMain("/meetings"); // first run: sign in here once; the recording windows share this sign-in
  } else if (!process.argv.includes("--hidden")) {
    showMain();
  }
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
  tray.on("click", () => showMain());
  updateTray();
  setInterval(poll, POLL_MS);
  poll();
});
