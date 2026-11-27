import { getUserClient } from "@/lib/server-auth";
import { encrypt } from "@/lib/crypto";
import { askModel, isProvider } from "@/lib/ai/provider";
import { LIMITS, readJsonBody } from "@/lib/body";

// GET: what is configured (never returns the key itself)
export async function GET(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const { data, error } = await auth.supabase
    .from("user_ai_settings")
    .select("provider, model, key_hint")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ settings: data });
}

// PUT: verify the key works with one tiny request, then store it encrypted
export async function PUT(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const read = await readJsonBody(request, LIMITS.small);
  if (!read.ok) return read.response;
  const body = read.value;
  const provider = body?.provider;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const model = typeof body?.model === "string" && body.model.trim() ? body.model.trim().slice(0, 100) : null;

  if (!isProvider(provider)) return Response.json({ error: "Choose a provider." }, { status: 400 });
  if (apiKey.length < 20 || apiKey.length > 300)
    return Response.json({ error: "That does not look like a valid API key." }, { status: 400 });

  try {
    await askModel({ provider, model, apiKey }, 'Reply with the JSON {"ok":true}', "ping");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "request failed";
    return Response.json({ error: `The provider rejected this key or model: ${msg}` }, { status: 400 });
  }

  let encrypted: string;
  try {
    encrypted = encrypt(apiKey);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Encryption failed." }, { status: 500 });
  }

  const { error } = await auth.supabase.from("user_ai_settings").upsert({
    user_id: auth.user.id,
    provider,
    model,
    encrypted_key: encrypted,
    key_hint: apiKey.slice(-4),
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}

// DELETE: remove the stored key
export async function DELETE(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });
  const { error } = await auth.supabase.from("user_ai_settings").delete().eq("user_id", auth.user.id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
