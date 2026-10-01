/**
 * What /api/health reports. Only true/false answers, never a value, so it is safe for anyone (and uptime monitors) to read.
 * It deliberately makes no calls to Supabase or any AI provider, so a monitor pinging it every minute costs nothing.
 */
export function healthReport(env: Record<string, string | undefined>, now: Date = new Date()) {
  const supabase = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  let encryptionKey = false;
  try {
    encryptionKey = Buffer.from(env.AI_KEY_ENCRYPTION_KEY ?? "", "base64").length === 32;
  } catch {
    encryptionKey = false;
  }
  const checks = { supabase, encryptionKey };
  return {
    status: supabase && encryptionKey ? ("ok" as const) : ("degraded" as const),
    checks,
    time: now.toISOString(),
  };
}
