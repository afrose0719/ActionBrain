import { getUserClient } from "@/lib/server-auth";
import { googleConfig } from "@/lib/google";

export async function GET(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const { data } = await auth.supabase.from("google_connections").select("google_email").maybeSingle();
  return Response.json({ configured: googleConfig() !== null, connected: !!data, email: data?.google_email ?? null });
}
