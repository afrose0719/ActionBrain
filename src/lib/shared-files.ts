// A recording shared to ActionBrain from the Android share sheet is held briefly by the service worker (public/sw.js)
// in the browser's own storage, then picked up here by the page and deleted. Nothing is sent to a server.
// The name below must match the one in public/sw.js (a test checks that).

export const SHARED_CACHE = "actionbrain-shared-v1";

/** The id the service worker puts in the address (?shared=...). Anything else is ignored. */
export const isSharedId = (id: unknown): id is string => typeof id === "string" && /^\d{10,}-[a-z0-9]{4,8}$/.test(id);

/** Fetches the shared file from the browser's storage and removes it. Returns null if it is not there (expired or used). */
export async function takeSharedFile(id: string, storage: Pick<CacheStorage, "open"> = caches): Promise<File | null> {
  if (!isSharedId(id)) return null;
  const cache = await storage.open(SHARED_CACHE);
  const key = `/__shared/${id}`;
  const response = await cache.match(key);
  if (!response) return null;
  const blob = await response.blob();
  const name = decodeURIComponent(response.headers.get("x-file-name") ?? "recording");
  await cache.delete(key); // use it once, then forget it
  return new File([blob], name, { type: blob.type });
}
