// The ActionBrain Android app (android/) opens this website in a window and adds one object to the page: window.ActionBrainAndroid.
// In an ordinary browser it does not exist, so everything here returns null and the website behaves exactly as before.
// The page must not trust it blindly: the status text is checked below before anything is shown.

export type AndroidBridge = {
  isApp(): boolean;
  /** Hands the private token to the app (it keeps it encrypted). True if the app accepted it. */
  saveIntake(address: string, token: string): boolean;
  clearIntake(): void;
  /** JSON text, see parseAndroidStatus. */
  status(): string;
  openNotificationAccess(): void;
  openBatterySettings(): void;
  openAppInfo(): void;
};

export type AndroidStatus = {
  version: string;
  /** The app holds a token and can send. */
  configured: boolean;
  /** Notification access is switched on for ActionBrain in Android's settings. */
  listening: boolean;
  sent: number;
  failed: number;
  /** Milliseconds since 1970, 0 if nothing yet. */
  lastAt: number;
  lastResult: string;
};

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
  if (sent === null || failed === null || lastAt === null || typeof d.lastResult !== "string") return null;
  return { version: d.version.slice(0, 20), configured: d.configured, listening: d.listening, sent, failed, lastAt, lastResult: d.lastResult.slice(0, 120) };
}
