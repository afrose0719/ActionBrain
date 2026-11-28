import { getUserClient } from "@/lib/server-auth";
import { LIMITS, readJsonBody } from "@/lib/body";
import { safeBaseUrl } from "@/lib/notetaker";

// Passes four requests on to the customer's own bot service (Vexa), because Vexa's API does not accept calls straight from a
// browser. The customer's key comes with each request and is never stored. Nothing here is saved: the transcript goes back to the
// customer's page, which turns it into a meeting.

const PLATFORMS = new Set(["google_meet", "teams", "zoom"]);
const ID = /^[A-Za-z0-9-]{1,40}$/;
const BOT_FIELDS = ["bot_name", "platform", "native_meeting_id", "passcode", "meeting_url", "language"] as const;
const MAX_REPLY = 2_000_000;

export async function POST(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const read = await readJsonBody(request, LIMITS.small);
  if (!read.ok) return read.response;
  const b = read.value ?? {};
  const base = typeof b.baseUrl === "string" ? safeBaseUrl(b.baseUrl) : null;
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!base) return Response.json({ error: "The bot service address must be https with a public name." }, { status: 400 });
  if (!key || key.length > 200 || /[\r\n]/.test(key)) return Response.json({ error: "Add your bot service key." }, { status: 400 });

  const platform = typeof b.platform === "string" ? b.platform : "";
  const id = typeof b.nativeId === "string" ? b.nativeId : "";
  const meeting = PLATFORMS.has(platform) && ID.test(id) ? `${platform}/${encodeURIComponent(id)}` : null;

  let path: string;
  let init: RequestInit;
  switch (b.action) {
    case "send": {
      const bot: Record<string, string> = {};
      for (const f of BOT_FIELDS) {
        const v = b.bot?.[f];
        if (typeof v === "string" && v.length <= 2000) bot[f] = v;
      }
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
      body = { detail: text.slice(0, 300) };
    }
    return Response.json({ ok: res.ok, status: res.status, body }, { status: 200 });
  } catch (e) {
    return Response.json({ error: `Could not reach the bot service (${e instanceof Error ? e.name : "error"}).` }, { status: 502 });
  }
}
