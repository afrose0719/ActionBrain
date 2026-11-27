import { getUserClient } from "@/lib/server-auth";
import { decrypt, encrypt } from "@/lib/crypto";
import { GoogleError, buildAuthUrl, exchangeCode, googleConfig, redirectUri, revokeToken } from "@/lib/google";
import { LIMITS, readJsonBody } from "@/lib/body";

// GET ?state=...  ->  the Google consent URL to send the browser to
export async function GET(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const cfg = googleConfig();
  if (!cfg) {
    return Response.json(
      { error: "Google Calendar is not set up on this server yet. See docs/google-calendar-setup.md.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  const state = new URL(request.url).searchParams.get("state") ?? "";
  if (!/^[A-Za-z0-9-]{16,80}$/.test(state)) return Response.json({ error: "Bad request." }, { status: 400 });

  return Response.json({ url: buildAuthUrl(cfg.id, redirectUri(request), state) });
}

// POST { code }  ->  trade Google's one-time code for a refresh token, store it encrypted
export async function POST(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const read = await readJsonBody(request, LIMITS.small);
  if (!read.ok) return read.response;
  const body = read.value;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code || code.length > 2000) return Response.json({ error: "Missing code." }, { status: 400 });

  try {
    const { refreshToken, email } = await exchangeCode(code, redirectUri(request));
    const { error } = await auth.supabase.from("google_connections").upsert({
      user_id: auth.user.id,
      encrypted_refresh_token: encrypt(refreshToken),
      google_email: email,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, email });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not connect." }, { status: e instanceof GoogleError ? 400 : 500 });
  }
}

// DELETE  ->  revoke the token at Google, then forget it
export async function DELETE(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const { data } = await auth.supabase.from("google_connections").select("encrypted_refresh_token").maybeSingle();
  if (data) {
    try {
      await revokeToken(decrypt(data.encrypted_refresh_token));
    } catch {
      /* if it cannot be decrypted we still delete it below */
    }
  }
  const { error } = await auth.supabase.from("google_connections").delete().eq("user_id", auth.user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
