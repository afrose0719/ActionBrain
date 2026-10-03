// While the Inbox is open, new Teams messages are fetched (if Microsoft Teams is connected) every couple of minutes.
// This is the browser-side part: it decides WHEN to ask the server to sync. The server does the work (src/app/api/microsoft/sync).

export const SYNC_EVERY_MS = 2 * 60_000;
const KEY = "ms_last_sync";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type Store = Pick<Storage, "getItem" | "setItem">;

/** True if at least two minutes have passed since the last time (or there was no last time, or the clock went backwards). */
export function isDue(now: number, last: number | null): boolean {
  return last === null || !Number.isFinite(last) || now < last || now - last >= SYNC_EVERY_MS;
}

function readLast(store: Store): number | null {
  try {
    const raw = store.getItem(KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null; // storage blocked: behave as if nothing was stored
  }
}

/**
 * Asks the server to import new Teams messages, at most once every two minutes per browser tab session.
 * Returns how many messages were added, or null when nothing was done (not due, not connected, not set up, or an error: Settings shows those).
 */
export async function syncTeamsIfDue(fetcher: Fetcher, store: Store, timeZone: string, now = Date.now()): Promise<{ stored: number } | null> {
  if (!isDue(now, readLast(store))) return null;
  try {
    store.setItem(KEY, String(now)); // marked first, so two quick calls do not both sync
  } catch {
    /* storage blocked: the interval in the page still limits how often this runs */
  }

  const status = await fetcher("/api/microsoft/status");
  if (!status.ok) return null;
  const info = (await status.json().catch(() => null)) as { configured?: boolean; connected?: boolean } | null;
  if (!info?.configured || !info.connected) return null;

  const res = await fetcher("/api/microsoft/sync", { method: "POST", body: JSON.stringify({ timeZone }) });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { stored?: number } | null;
  return { stored: typeof body?.stored === "number" ? body.stored : 0 };
}
