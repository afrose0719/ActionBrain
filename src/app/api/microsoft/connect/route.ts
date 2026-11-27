import { getUserClient } from "@/lib/server-auth";
import { encrypt } from "@/lib/crypto";
import { MicrosoftError, buildAuthUrl, exchangeCode, microsoftConfig, redirectUri } from "@/lib/microsoft";
import { LIMITS, readJsonBody } from "@/lib/body";

// GET ?state=...  ->  the Microsoft sign-in URL to send the browser to
export async function GET(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const cfg = microsoftConfig();
  if (!cfg) {
    return Response.json(
      { error: "Microsoft Teams is not set up on this server yet. See docs/microsoft-teams-setup.md.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  const state = new URL(request.url).searchParams.get("state") ?? "";
  if (!/^[A-Za-z0-9-]{16,80}$/.test(state)) return Response.json({ error: "Bad request." }, { status: 400 });

  return Response.json({ url: buildAuthUrl(cfg.id, redirectUri(request), state, cfg.tenant) });
}

// POST { code }  ->  trade Microsoft's one-time code for a refresh token, store it encrypted
export async function POST(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const read = await readJsonBody(request, LIMITS.small);
  if (!read.ok) return read.response;
  const body = read.value;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code || code.length > 4000) return Response.json({ error: "Missing code." }, { status: 400 });

  try {
    const { refreshToken, scopes, identity } = await exchangeCode(code, redirectUri(request));
    const { error } = await auth.supabase.from("microsoft_connections").upsert({
      user_id: auth.user.id,
      encrypted_refresh_token: encrypt(refreshToken),
      ms_user_id: identity.userId,
      tenant_id: identity.tenantId,
      account: identity.account,
      scopes: scopes.join(" "),
      connected_at: new Date().toISOString(), // only messages from now on are imported, never old history
      last_synced_at: null,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, account: identity.account });
  } catch (e) {
    if (e instanceof MicrosoftError) return Response.json({ error: e.message, code: e.code }, { status: 400 });
    return Response.json({ error: "Could not connect." }, { status: 500 });
  }
}

// DELETE  ->  forget the saved sign-in. (Microsoft has no "revoke" call for this; the person can also remove ActionBrain at myaccount.microsoft.com.)
export async function DELETE(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const { error } = await auth.supabase.from("microsoft_connections").delete().eq("user_id", auth.user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
