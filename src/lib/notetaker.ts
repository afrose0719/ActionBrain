import { getSecret, migrateSecret, setSecret } from "./secret-store.ts";

// Meeting notetaker bot, Fireflies style (Milestone 37). The customer brings their OWN bot service: Vexa (open source, Apache-2.0),
// either self-hosted or Vexa's hosted API with their own key. ActionBrain sends "ActionBrain Notetaker" into Google Meet, Teams or
// Zoom (by hand, or automatically from the calendar), collects the speaker-labelled transcript afterwards, and turns it into
// notes and tasks. The owner of ActionBrain pays nothing for bots and keeps no bot key.

export type Platform = "google_meet" | "teams" | "zoom";
export type MeetingRef = { platform: Platform; nativeId: string; passcode?: string; meetingUrl: string };

/** Reads a Meet, Teams or Zoom join link. Null for anything else. */
export function parseMeetingLink(raw: string): MeetingRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  const meetingUrl = url.toString();

  if (host === "meet.google.com") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(id) ? { platform: "google_meet", nativeId: id, meetingUrl } : null;
  }
  if (host === "teams.microsoft.com" || host === "teams.live.com" || host.endsWith(".teams.microsoft.com")) {
    // newer links: /meet/<numeric id>?p=<passcode>; classic links: /l/meetup-join/... (sent whole as meeting_url)
    const m = /^\/meet\/(\d{9,17})/.exec(url.pathname);
    if (m) return { platform: "teams", nativeId: m[1], passcode: url.searchParams.get("p") ?? undefined, meetingUrl };
    if (url.pathname.startsWith("/l/meetup-join/")) return { platform: "teams", nativeId: "", meetingUrl };
    return null;
  }
  if (host === "zoom.us" || host.endsWith(".zoom.us")) {
    const m = /\/(?:j|wc\/join)\/(\d{9,12})/.exec(url.pathname);
    return m ? { platform: "zoom", nativeId: m[1], passcode: url.searchParams.get("pwd") ?? undefined, meetingUrl } : null;
  }
  return null;
}

export const BOT_NAME = "ActionBrain Notetaker";

const ISO: Record<string, string> = {
  english: "en", hindi: "hi", tamil: "ta", telugu: "te", malayalam: "ml", kannada: "kn", marathi: "mr", bengali: "bn",
  gujarati: "gu", urdu: "ur", spanish: "es", french: "fr", german: "de", arabic: "ar",
};

/** The body for Vexa's POST /bots. Language left out = detected for each stretch of speech (best for mixed meetings). */
export function botRequest(ref: MeetingRef, opts: { botName?: string; language?: string | null } = {}): Record<string, string | boolean> {
  // recording_enabled false: hosted Vexa keeps the meeting AUDIO unless told not to; ActionBrain only needs the text (round 9)
  const body: Record<string, string | boolean> = { bot_name: (opts.botName || BOT_NAME).slice(0, 60), recording_enabled: false };
  if (ref.nativeId) {
    body.platform = ref.platform;
    body.native_meeting_id = ref.nativeId;
    if (ref.passcode) body.passcode = ref.passcode;
  } else {
    body.meeting_url = ref.meetingUrl; // a classic Teams link: Vexa reads platform, id and tenant from it
  }
  const lang = opts.language ? ISO[opts.language] : undefined;
  if (lang) body.language = lang;
  return body;
}

export type Segment = { text?: unknown; speaker?: unknown; absolute_start_time?: unknown; start_time?: unknown };

/** Vexa's speaker-labelled segments as a readable transcript: one paragraph per turn, "Name: what they said". */
export function transcriptText(segments: Segment[]): string {
  const ordered = segments
    .filter((s) => typeof s.text === "string" && s.text.trim())
    .map((s, i) => ({
      text: (s.text as string).trim(),
      speaker: typeof s.speaker === "string" && s.speaker.trim() ? s.speaker.trim() : "Speaker",
      at: typeof s.absolute_start_time === "string" ? Date.parse(s.absolute_start_time) : typeof s.start_time === "number" ? s.start_time * 1000 : i,
      i,
    }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at - b.at));
  const turns: { speaker: string; parts: string[] }[] = [];
  for (const s of ordered) {
    const last = turns.at(-1);
    if (last && last.speaker === s.speaker) {
      if (last.parts.at(-1) !== s.text) last.parts.push(s.text); // the live stream can repeat a confirmed segment
    } else turns.push({ speaker: s.speaker, parts: [s.text] });
  }
  return turns.map((t) => `${t.speaker}: ${t.parts.join(" ")}`).join("\n\n");
}

/** Who spoke (for the meeting's attendees field). */
export function speakersOf(segments: Segment[]): string[] {
  return [...new Set(segments.map((s) => (typeof s.speaker === "string" ? s.speaker.trim() : "")).filter(Boolean))];
}

export type CalendarLike = { id: string; title: string; start: string; allDay: boolean; link: string | null };

/**
 * Calendar meetings the bot should join now: a Meet/Teams/Zoom link, starting from 2 minutes ago to 1 minute ahead,
 * not already sent. (The page checks every minute, so each meeting is caught once.)
 */
export function meetingsToJoin(events: CalendarLike[], now: number, alreadySent: Set<string>): (CalendarLike & { ref: MeetingRef })[] {
  const out: (CalendarLike & { ref: MeetingRef })[] = [];
  for (const e of events) {
    if (e.allDay || !e.link || alreadySent.has(e.id)) continue;
    const start = Date.parse(e.start);
    if (!(start - now <= 60_000 && now - start <= 120_000)) continue;
    const ref = parseMeetingLink(e.link);
    if (ref) out.push({ ...e, ref });
  }
  return out;
}

/**
 * Where the customer's bot service lives. Vexa's hosted API, or their own server (https only, a public host name),
 * because ActionBrain's server passes the requests on and must not be pointed at internal addresses.
 */
export const HOSTED_VEXA = "https://api.cloud.vexa.ai";
export function safeBaseUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (host === "localhost" || /\.(local|internal|localhost|lan|home)$/.test(host) || !host.includes(".")) return null;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return null; // IP literals (v4 and v6)
  return u.origin + u.pathname.replace(/\/+$/, "");
}

// ---------------- settings and the bots sent, kept only in this browser ----------------

export type NotetakerPrefs = { baseUrl: string; key: string; botName: string; autoJoin: boolean; language: string | null; remember?: boolean };
export type SentBot = { platform: Platform; nativeId: string; meetingUrl: string; title: string; sentAt: number; eventId?: string };

const PREFS = "actionbrain.notetaker";
const SENT = "actionbrain.notetaker.sent";
const read = <T,>(k: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? "null") as T) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* private mode */
  }
};

export function loadNotetakerPrefs(): NotetakerPrefs {
  const p = read<Partial<NotetakerPrefs>>(PREFS, {});
  migrateSecret("vexa", p.key); // the first version kept the key inside these settings
  if (p.key) write(PREFS, { ...p, key: undefined, remember: true });
  const key = getSecret("vexa");
  return {
    baseUrl: typeof p.baseUrl === "string" && p.baseUrl ? p.baseUrl : HOSTED_VEXA,
    key: key.value,
    botName: typeof p.botName === "string" && p.botName.trim() ? p.botName : BOT_NAME,
    autoJoin: p.autoJoin === true,
    language: typeof p.language === "string" ? p.language : null,
    remember: p.remember === true || key.remembered,
  };
}
export const saveNotetakerPrefs = (p: NotetakerPrefs) => {
  write(PREFS, { ...p, key: undefined }); // the key goes to the secret store, never into these settings
  setSecret("vexa", p.key, Boolean(p.remember));
};
export const loadSentBots = (): SentBot[] => read<SentBot[]>(SENT, []).filter((b) => b && typeof b.nativeId === "string");
export const saveSentBots = (b: SentBot[]) => write(SENT, b.slice(-50));

// ---------------- what may come back from the bot service (kept small: no raw upstream data reaches the page) ----------------

/** Only the fields the page uses, from any Vexa reply. Unknown fields are dropped. */
export function cleanBotReply(action: string, body: unknown): unknown {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : undefined);
  if (action === "send") return { platform: str(o.platform, 20), native_meeting_id: str(o.native_meeting_id, 60), status: str(o.status, 40) };
  if (action === "status") {
    const list = Array.isArray(o.running_bots) ? o.running_bots : Array.isArray(o.bots) ? o.bots : Array.isArray(body) ? (body as unknown[]) : [];
    return {
      running: list
        .map((b) => (b && typeof b === "object" ? (b as Record<string, unknown>) : {}))
        .map((b) => ({ platform: str(b.platform, 20), native_meeting_id: str(b.native_meeting_id, 60), status: str(b.status, 40) }))
        .filter((b) => b.native_meeting_id)
        .slice(0, 50),
    };
  }
  if (action === "transcript") {
    const segs = Array.isArray(o.segments) ? o.segments : [];
    return {
      segments: segs.slice(0, 20000).map((x) => {
        const s = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        return {
          text: str(s.text, 5000),
          speaker: str(s.speaker, 120),
          absolute_start_time: str(s.absolute_start_time, 40),
          start_time: typeof s.start_time === "number" ? s.start_time : undefined,
        };
      }),
    };
  }
  return {};
}

/** A short error for the page, without echoing what the bot service said (it could contain internal details). */
export function botError(status: number): string {
  if (status === 401 || status === 403) return "The bot service refused the key. Check your Vexa key.";
  if (status === 402) return "Your bot service account has no credit left.";
  if (status === 404) return "The bot service does not know that meeting (it may have ended).";
  if (status === 409) return "A notetaker is already in that meeting.";
  if (status === 422) return "The bot service could not read that meeting link.";
  if (status === 429) return "Too many requests to the bot service. Wait a minute.";
  return `The bot service had a problem (${status}).`;
}

/** A self-hosted bot service must resolve only to public addresses (stops DNS tricks that point at internal networks). */
export function isPublicAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPublicAddress(v6.slice(7));
  return !(v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80"));
}
