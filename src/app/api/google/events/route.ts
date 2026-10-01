import { getUserClient } from "@/lib/server-auth";
import { decrypt } from "@/lib/crypto";
import { GoogleError, accessTokenFrom, listEvents } from "@/lib/google";

const DAY = 86_400_000;

// GET  ->  events from 7 days ago to 7 days ahead, from the user's primary calendar
export async function GET(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const { data } = await auth.supabase.from("google_connections").select("encrypted_refresh_token").maybeSingle();
  if (!data) {
    return Response.json({ error: "Google Calendar is not connected. Connect it in Settings.", code: "NOT_CONNECTED" }, { status: 400 });
  }

  try {
    const accessToken = await accessTokenFrom(decrypt(data.encrypted_refresh_token));
    const now = Date.now();
    const events = await listEvents(accessToken, new Date(now - 7 * DAY), new Date(now + 7 * DAY));
    return Response.json({ events });
  } catch (e) {
    if (e instanceof GoogleError && e.code === "TOKEN_REVOKED") {
      await auth.supabase.from("google_connections").delete().eq("user_id", auth.user.id); // dead token: forget it
      return Response.json({ error: e.message, code: "TOKEN_REVOKED" }, { status: 400 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "Could not read your calendar." }, { status: 502 });
  }
}
