import { createBrowserClient } from "@supabase/ssr";

// One shared Supabase client for browser (client component) code.
// The URL and anon key are safe to expose: Row Level Security protects the data.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
