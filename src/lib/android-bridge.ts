// The ActionBrain Android app (android/) opens this website in a window and adds one object to the page: window.ActionBrainAndroid.
// In an ordinary browser it does not exist, so everything here returns null and the website behaves exactly as before.
// The page must not trust it blindly: the status text is checked below before anything is shown.

export type AndroidBridge = {
  // present in every version of the app
  isApp(): boolean;
  /** Hands the private token to the app (it keeps it encrypted). True if the app accepted it. */
  saveIntake(address: string, token: string): boolean;
  clearIntake(): void;
  /** JSON text, see parseAndroidStatus. */
  status(): string;
  openNotificationAccess(): void;
  openBatterySettings(): void;
  openAppInfo(): void;

  // added later: an older app does not have them, so always call these with ?.()
  /** A chat export shared to the app: JSON text, see parseSharedFile. "" when nothing is waiting. Reading it clears it. */
  takeSharedFile?(): string;
  /** Shows the app's own consent dialog, then opens Android's Accessibility settings (only in the "full" app). */
  openScreenReadingSettings?(): void;
  /** What the reading service sees, as structure only (no message text). "" if nothing yet. */
  screenStructure?(): string;
  /** Switch notification capture on or off. */
  setNotificationsEnabled?(on: boolean): void;
  /** "off", "auto" or "tap". False if the app refused it. */
  setReadingMode?(mode: string): boolean;
  /** Switch a chat app ("whatsapp" or "teams") on or off. Teams asks for the user's agreement first, in the app's own dialog. */
  setAppEnabled?(source: string, on: boolean): boolean;
  /** The shape of the latest notification from each chat app, with no message text. */
  notificationStructure?(): string;
  /** Pause all capture for this many minutes (1 to 1440). 0 resumes. */
  pauseCapture?(minutes: number): void;
  /** Bring the floating button back after it was hidden for the day. */
  showBubbleAgain?(): void;
  /** Ask Android to add the Quick Settings tile (Android 13+), or explain how. */
  addQuickSettingsTile?(): void;
  /** Zero-touch switches changed: the app forgets a remembered "off" (app 0.6.0+). */
  autoSettingsChanged?(): void;
  /** Delete messages still waiting in the phone's offline queue; returns how many (app 0.7.0+). */
  clearQueue?(): number;
  /** Explain, then open Android's default-assistant screen, so a long-press captures the open chat (app 0.8.0+, Play-safe). */
  openAssistantSettings?(): void;
  /** After-call recap on or off; switching on shows the app's own explanation, then Android's notification permission (0.9.0+). */
  setCallRecap?(on: boolean): void;
};

export type ReadingMode = "off" | "auto" | "tap";

export type ChatAppSource = "whatsapp" | "teams";

/** The user's capture choices, as the app holds them. Null in `AndroidStatus.controls` for an app too old to have them. */
export type CaptureControls = {
  notificationsOn: boolean;
  readingMode: ReadingMode;
  /** Milliseconds since 1970 when the pause ends; in the past (or 0) means not paused. */
  pausedUntil: number;
  /** The floating button was hidden for today. */
  bubbleHidden: boolean;
  /** Which chat apps are switched on. An app older than 0.5.0 does not say, so this shows WhatsApp on and Teams off. */
  apps: Record<ChatAppSource, boolean>;
};

export type AndroidStatus = {
  version: string;
  /** The app holds a token and can send. */
  configured: boolean;
  /** Notification access is switched on for ActionBrain in Android's settings. */
  listening: boolean;
  /** This build of the app contains live chat reading (the "full" build, not the Play one). */
  screenAvailable: boolean;
  /** Live chat reading is switched on in Android's Accessibility settings. */
  screenOn: boolean;
  sent: number;
  failed: number;
  /** Milliseconds since 1970, 0 if nothing yet. */
  lastAt: number;
  lastResult: string;
  /** Messages kept (encrypted) on the phone, waiting for a network. 0 for apps older than 0.7.0. */
  queued: number;
  /** Messages the phone had to drop (queue full, older than 7 days, unreadable). Never silent. */
  dropped: number;
  /** ActionBrain is the default digital assistant (long-press to capture). false for apps older than 0.8.0. */
  assistant: boolean;
  /** The after-call recap is switched on (0.9.0+). */
  callRecap: boolean;
  /** Android lets ActionBrain show notifications (needed for the recap). */
  notificationsAllowed: boolean;
  controls: CaptureControls | null;
};

// A look-alike object is refused unless it has all of these (every app version has them). Newer methods are checked where they are used.
const METHODS = ["isApp", "saveIntake", "clearIntake", "status", "openNotificationAccess", "openBatterySettings", "openAppInfo"] as const;

/** The app's bridge, or null in a normal browser (or if something else defined a look-alike object). */
export function getAndroidBridge(host: unknown = typeof window === "undefined" ? undefined : window): AndroidBridge | null {
  const candidate = (host as { ActionBrainAndroid?: Record<string, unknown> } | undefined)?.ActionBrainAndroid;
  if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) return null;
  for (const name of METHODS) if (typeof candidate[name] !== "function") return null;
  return candidate as unknown as AndroidBridge;
}

/** Reads the app's status JSON. Returns null for anything that is not exactly the expected shape. */
export function parseAndroidStatus(json: unknown): AndroidStatus | null {
  if (typeof json !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const sent = count(d.sent);
  const failed = count(d.failed);
  const lastAt = count(d.lastAt);
  if (d.app !== true || typeof d.version !== "string" || typeof d.configured !== "boolean" || typeof d.listening !== "boolean") return null;
  // Apps older than 0.3.0 do not send the two live-reading fields: treat missing as "not available". Wrong types are still refused.
  const optional = (v: unknown) => (v === undefined ? false : typeof v === "boolean" ? v : null);
  const screenAvailable = optional(d.screenAvailable);
  const screenOn = optional(d.screenOn);
  if (screenAvailable === null || screenOn === null) return null;
  if (sent === null || failed === null || lastAt === null || typeof d.lastResult !== "string") return null;
  // Milestone 30 fields: missing (older app) = 0; present but wrong = refuse
  const queued = d.queued === undefined ? 0 : count(d.queued);
  const dropped = d.dropped === undefined ? 0 : count(d.dropped);
  if (queued === null || dropped === null) return null;
  const assistant = optional(d.assistant);
  if (assistant === null) return null;
  const callRecap = optional(d.callRecap);
  const notificationsAllowed = optional(d.notificationsAllowed);
  if (callRecap === null || notificationsAllowed === null) return null;
  const controls = parseControls(d);
  if (controls === undefined) return null;
  return { version: d.version.slice(0, 20), configured: d.configured, listening: d.listening, screenAvailable, screenOn, sent, failed, lastAt, lastResult: d.lastResult.slice(0, 120), queued, dropped, assistant, callRecap, notificationsAllowed, controls };
}

export type SharedFile = { ok: true; name: string; text: string } | { ok: false; error: string };

/** Reads what takeSharedFile() returned. Null if nothing was waiting (or it is not the expected shape). */
export function parseSharedFile(json: unknown): SharedFile | null {
  if (typeof json !== "string" || json === "") return null;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.error === "string") return { ok: false, error: d.error.slice(0, 200) };
  if (typeof d.name !== "string" || typeof d.text !== "string") return null;
  return { ok: true, name: d.name.slice(0, 200), text: d.text };
}

/** null = an older app without capture controls. undefined = the app sent them but they are not the expected shape. */
function parseControls(d: Record<string, unknown>): CaptureControls | null | undefined {
  if (d.readingMode === undefined && d.notificationsOn === undefined && d.pausedUntil === undefined && d.bubbleHidden === undefined) return null;
  const mode = d.readingMode;
  if (mode !== "off" && mode !== "auto" && mode !== "tap") return undefined;
  if (typeof d.notificationsOn !== "boolean" || typeof d.bubbleHidden !== "boolean") return undefined;
  if (typeof d.pausedUntil !== "number" || !Number.isFinite(d.pausedUntil) || d.pausedUntil < 0) return undefined;
  let apps: Record<ChatAppSource, boolean> = { whatsapp: true, teams: false };
  if (d.apps !== undefined) {
    const a = d.apps as Record<string, unknown> | null;
    if (typeof a !== "object" || a === null || typeof a.whatsapp !== "boolean" || typeof a.teams !== "boolean") return undefined;
    apps = { whatsapp: a.whatsapp, teams: a.teams };
  }
  return { notificationsOn: d.notificationsOn, readingMode: mode, pausedUntil: Math.floor(d.pausedUntil), bubbleHidden: d.bubbleHidden, apps };
}
