// Phone message intake (Milestone 22): a notification on your phone (for example a WhatsApp message) is sent to your
// private ActionBrain address and lands in the Inbox. The pure parts live here so they can be tested without a server.
//
// Why a token and not a login: the phone automation app cannot sign in the way you do. Instead each user gets one long random
// token. Only its SHA-256 hash is stored, so a leaked database does not leak working tokens. The hash must be computed the same
// way here and in supabase/milestone22-intake.sql: sha256 of the UTF-8 text, written as lowercase hex.

export const TOKEN_PREFIX = "abi_";
export const MAX_TEXT = 1500;
export const MAX_SENDER = 100;
export const MAX_SENDERS = 100;

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** A new secret token: 32 random bytes (256 bits), so it cannot be guessed. Shown to the user once. */
export function generateToken(): string {
  return TOKEN_PREFIX + toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of the token as lowercase hex. This is the only form that is stored. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Tokens look like "abi_" + 43 URL-safe characters. Anything else is rejected before touching the database. */
export const looksLikeToken = (value: unknown): value is string => typeof value === "string" && /^abi_[A-Za-z0-9_-]{43}$/.test(value);

/** Reads the token from "Authorization: Bearer ..." or "x-actionbrain-token". Returns null if there is none. */
export function tokenFromHeaders(headers: Pick<Headers, "get">): string | null {
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const candidate = bearer || headers.get("x-actionbrain-token")?.trim();
  return looksLikeToken(candidate) ? candidate : null;
}

/** "Rajesh, Priya\nMom" -> ["Rajesh","Priya","Mom"]. Blank entries and repeats are dropped; the list is capped. */
export function parseSenderList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n,;]/)) {
    const name = part.trim().slice(0, MAX_SENDER);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_SENDERS) break;
  }
  return out;
}

export type Notification = { sender: string; text: string; group: string | null };
export type NotificationResult = { ok: true; message: Notification } | { ok: false; reason: string };

// WhatsApp posts notifications that are not messages. They carry no task, so they are dropped here.
const SYSTEM_TEXT = /^(checking for new messages|whatsapp web is currently active|backup in progress|\d+ new messages?|\d+ messages? from \d+ chats?|ongoing voice call|ongoing video call|incoming voice call|incoming video call|missed voice call|missed video call)\.?$/i;
// Media has no words to read, only a label.
const MEDIA_ONLY = /^(?:[\p{Extended_Pictographic}️\s]*)(photo|video|voice message|audio|document|sticker|gif|contact|location|live location|poll)(?:\s*\(?[\d:]*\)?)?\s*$/iu;

const clean = (value: unknown) => (typeof value === "string" ? value.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim() : "");

/**
 * Turns what the phone sends into one message, or says why it is ignored.
 * Accepts JSON {"title","text"} (aliases: "sender"/"message"), or plain text where the FIRST LINE is the title and the rest is the
 * message. Plain text is the easy way for automation apps: no quotes or newlines to escape.
 */
export function readNotification(contentType: string | null, body: string): NotificationResult {
  let title = "";
  let text = "";
  let group = "";

  if ((contentType ?? "").toLowerCase().includes("json")) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      return { ok: false, reason: "invalid" };
    }
    if (typeof data !== "object" || data === null) return { ok: false, reason: "invalid" };
    const d = data as Record<string, unknown>;
    title = clean(d.title ?? d.sender);
    text = clean(d.text ?? d.message);
    group = clean(d.group);
  } else {
    const trimmed = clean(body);
    const newline = trimmed.indexOf("\n");
    title = newline === -1 ? "" : trimmed.slice(0, newline).trim();
    text = newline === -1 ? trimmed : trimmed.slice(newline + 1).trim();
  }

  if (!text) return { ok: false, reason: "empty" };
  if (title.toLowerCase() === "whatsapp" || SYSTEM_TEXT.test(text)) return { ok: false, reason: "system" };
  if (!/[\p{L}\p{N}]/u.test(text) || MEDIA_ONLY.test(text)) return { ok: false, reason: "no-text" };

  // 1:1 chats with several unread messages are titled "Rajesh (3 messages)"; the name is what matters.
  title = title.replace(/\s*\(\d+\s+messages?\)\s*$/i, "").trim();

  // Groups are titled "Group name: Sender" (best effort: if your phone words them differently, use the allowed-senders list).
  if (!group) {
    const colon = title.indexOf(": ");
    if (colon > 0) {
      group = title.slice(0, colon).trim();
      title = title.slice(colon + 2).trim();
    }
  }

  return {
    ok: true,
    message: { sender: (title || "Unknown").slice(0, MAX_SENDER), text: text.slice(0, MAX_TEXT), group: group ? group.slice(0, MAX_SENDER) : null },
  };
}
