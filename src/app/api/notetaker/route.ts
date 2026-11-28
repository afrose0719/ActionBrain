import { lookup } from "node:dns/promises";
import { getUserClient } from "@/lib/server-auth";
import { LIMITS, readJsonBody } from "@/lib/body";
import { botError, cleanBotReply, HOSTED_VEXA, isPublicAddress, safeBaseUrl } from "@/lib/notetaker";

// Passes four requests on to the customer's own bot service (Vexa), because Vexa's API does not accept calls straight from a
// browser. (Inside the Windows helper the requests go straight to Vexa and never come here.) The customer's key comes with each
// request and is never stored or logged. Replies are cut down to the few fields the page uses. Nothing is saved.
// Honest limit: the transcript does pass through this server's memory on its way back to the customer's browser.

const PLATFORMS = new Set(["google_meet", "teams", "zoom"]);
const ID = /^[A-Za-z0-9-]{1,40}$/;
const BOT_FIELDS = ["bot_name", "platform", "native_meeting_id", "passcode", "meeting_url", "language"] as const;
const MAX_REPLY = 2_000_000;

// A small per-user brake (per server instance) so a stuck page cannot hammer the customer's bot account or this server.
const recent = new Map<string, number[]>();
function tooMany(userId: string, now = Date.now()): boolean {
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(userId, list);
  if (recent.size > 5000) recent.clear();
  return list.length > 30;
}

async function allowedBase(raw: unknown): Promise<string | null> {
  const base = typeof raw === "string" ? safeBaseUrl(raw) : null;
  if (!base) return null;
  if (base === HOSTED_VEXA) return base;
  const url = new URL(base);
  if (url.port && url.port !== "443") return null;
  try {
    const addrs = await lookup(url.hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => isPublicAddress(a.address)) ? base : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });
  if (tooMany(auth.user.id)) return Response.json({ error: "Too many requests. Wait a minute." }, { status: 429 });

  const read = await readJsonBody(request, LIMITS.small);
  if (!read.ok) return read.response;
  const b = read.value ?? {};
  const base = await allowedBase(b.baseUrl);
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!base) return Response.json({ error: "The bot service address must be https on a public server." }, { status: 400 });
  if (!key || key.length > 200 || /[\r\n]/.test(key)) return Response.json({ error: "Add your bot service key." }, { status: 400 });

  const platform = typeof b.platform === "string" ? b.platform : "";
  const id = typeof b.nativeId === "string" ? b.nativeId : "";
  const meeting = PLATFORMS.has(platform) && ID.test(id) ? `${platform}/${encodeURIComponent(id)}` : null;
  const action = typeof b.action === "string" ? b.action : "";

  let path: string;
  let init: RequestInit;
  switch (action) {
    case "send": {
      const bot: Record<string, string | boolean> = { recording_enabled: false }; // never ask the bot service to keep audio
      for (const f of BOT_FIELDS) {
        const v = b.bot?.[f];
        if (typeof v === "string" && v.length <= 2000) bot[f] = v;
      }
      if (bot.platform && !PLATFORMS.has(String(bot.platform))) return Response.json({ error: "Unknown meeting platform." }, { status: 400 });
      if (!bot.native_meeting_id && !bot.meeting_url) return Response.json({ error: "No meeting given." }, { status: 400 });
      path = "/bots";
      init = { method: "POST", body: JSON.stringify(bot) };
      break;
    }
    case "status":
      path = "/bots/status";
      init = { method: "GET" };
      break;
    case "transcript":
      if (!meeting) return Response.json({ error: "Unknown meeting." }, { status: 400 });
      path = `/transcripts/${meeting}`;
      init = { method: "GET" };
      break;
    case "stop":
      if (!meeting) return Response.json({ error: "Unknown meeting." }, { status: 400 });
      path = `/bots/${meeting}`;
      init = { method: "DELETE" };
      break;
    default:
      return Response.json({ error: "Unknown action." }, { status: 400 });
  }

  try {
    const res = await fetch(base + path, {
      ...init,
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      redirect: "error", // never follow a redirect to somewhere else
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const text = await res.text();
    if (text.length > MAX_REPLY) return Response.json({ error: "The bot service sent too much data." }, { status: 502 });
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return Response.json({ ok: res.ok, status: res.status, body: res.ok ? cleanBotReply(action, body) : null, ...(res.ok ? {} : { message: botError(res.status) }) });
  } catch {
    return Response.json({ error: "Could not reach the bot service." }, { status: 502 });
  }
}
