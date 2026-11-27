import { getUserClient } from "@/lib/server-auth";
import { decrypt, encrypt } from "@/lib/crypto";
import { MicrosoftError, accessTokenFrom, fetchMyId, microsoftConfig, syncTeams } from "@/lib/microsoft";
import { LIMITS, readJsonBody } from "@/lib/body";

export const maxDuration = 30; // reading chats can take a few seconds

const validZone = (zone: unknown): zone is string => {
  if (typeof zone !== "string" || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

// POST { timeZone? }  ->  imports the NEW messages from your Teams chats into the Inbox
export async function POST(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });
  if (!microsoftConfig()) return Response.json({ error: "Microsoft Teams is not set up on this server yet.", code: "NOT_CONFIGURED" }, { status: 503 });

  const read = await readJsonBody(request, LIMITS.small);
  if (!read.ok) return read.response;
  const body = read.value;
  const timeZone = validZone(body?.timeZone) ? body.timeZone : null;

  const { data: connection } = await auth.supabase
    .from("microsoft_connections")
    .select("encrypted_refresh_token, ms_user_id, connected_at, last_synced_at")
    .maybeSingle();
  if (!connection) return Response.json({ error: "Microsoft Teams is not connected.", code: "NOT_CONNECTED" }, { status: 400 });

  try {
    const stored = decrypt(connection.encrypted_refresh_token);
    const { accessToken, refreshToken } = await accessTokenFrom(stored);

    const update: Record<string, string> = {};
    if (refreshToken !== stored) update.encrypted_refresh_token = encrypt(refreshToken); // Microsoft rotated it: keep the new one
    let myId: string | null = connection.ms_user_id;
    if (!myId) {
      myId = await fetchMyId(accessToken);
      if (myId) update.ms_user_id = myId;
    }

    const since = connection.last_synced_at ?? connection.connected_at;
    const plan = await syncTeams(accessToken, since, myId);

    const counts = { stored: 0, duplicate: 0, ignored: 0, limit: 0 };
    for (const item of plan.items) {
      const { data, error } = await auth.supabase.rpc("ingest_my_message", {
        p_source: item.source,
        p_sender: item.sender,
        p_text: item.text,
        p_group: item.group,
        p_mine: item.mine,
        p_sent_at: item.sentAt,
        p_timezone: timeZone,
      });
      if (error) return Response.json({ error: "Could not save the messages.", ...counts }, { status: 502 });
      if (data === "stored" || data === "duplicate" || data === "ignored" || data === "limit") counts[data as keyof typeof counts]++;
      if (data === "limit") break; // the daily cap: stop and say so
    }

    // only move forward once the messages are saved (a failure above leaves "since" where it was, so nothing is skipped)
    // (and not at all if the daily cap stopped us part-way: the rest must be picked up by the next sync)
    const complete = counts.limit === 0;
    if (complete && plan.newest && (!connection.last_synced_at || Date.parse(plan.newest) > Date.parse(connection.last_synced_at))) update.last_synced_at = plan.newest;
    if (Object.keys(update).length > 0) await auth.supabase.from("microsoft_connections").update(update).eq("user_id", auth.user.id);

    return Response.json({ ok: true, chatsChecked: plan.chatsChecked, found: plan.items.length, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof MicrosoftError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.code === "RATE_LIMITED" ? 429 : 400 });
    }
    return Response.json({ error: "Could not read Teams. Try again, or reconnect in Settings." }, { status: 500 });
  }
}
