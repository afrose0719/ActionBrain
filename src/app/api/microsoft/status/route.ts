import { getUserClient } from "@/lib/server-auth";
import { microsoftConfig } from "@/lib/microsoft";

export async function GET(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const { data } = await auth.supabase.from("microsoft_connections").select("account, connected_at, last_synced_at").maybeSingle();
  return Response.json({
    configured: microsoftConfig() !== null,
    connected: !!data,
    account: data?.account ?? null,
    connectedAt: data?.connected_at ?? null,
    lastSyncedAt: data?.last_synced_at ?? null,
  });
}
