import { createClient } from "@supabase/supabase-js";

/**
 * For API routes: verifies the caller's login token and returns a Supabase client that acts AS that user,
 * so Row Level Security applies. Returns null if not logged in.
 */
export async function getUserClient(request: Request) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase.auth.getUser(token);
  return data.user ? { supabase, user: data.user } : null;
}
