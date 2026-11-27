// GET /api/cron/keepalive   (run once a day by Vercel Cron, see vercel.json; free on the Hobby plan)
// Makes one tiny real database read so the free Supabase project is not paused for inactivity (it pauses after 7 days without
// activity). Review: both ChatGPT and Gemini advised a daily server-side job over GitHub Actions (scheduled workflows stop after 60
// days of repository inactivity). It is a safeguard, not a guarantee: Supabase does not promise that any request counts.
//
// The read uses the public key and Row Level Security, so it sees nothing (an empty list) and returns nothing. When CRON_SECRET is
// set, only Vercel Cron (which sends it) can trigger it.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed." }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ status: "not_configured" }, { status: 503 });

  try {
    const res = await fetch(`${url}/rest/v1/inbox_items?select=id&limit=1`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    return Response.json({ status: res.ok ? "ok" : "database_error", code: res.status }, { status: res.ok ? 200 : 502 });
  } catch {
    return Response.json({ status: "unreachable" }, { status: 502 });
  }
}
