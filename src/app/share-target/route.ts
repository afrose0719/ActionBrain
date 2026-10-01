// The Android share sheet sends a POST here. When the app is installed, the service worker (public/sw.js) catches it
// first and this code never runs. This is the fallback for when the service worker is not active yet (just after
// installing, or if it was cleared): the shared FILE cannot be saved, but shared TEXT still reaches the Inbox.

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const query = new URLSearchParams();
  for (const key of ["title", "text", "url"]) {
    const value = form?.get(key);
    if (typeof value === "string" && value.trim()) query.set(key, value.slice(0, 6000));
  }
  const hadFile = !!form && form.getAll("audio").some((f) => typeof f === "object");
  if (hadFile && !query.size) query.set("text", "A recording was shared, but ActionBrain was not ready to receive it yet. Open the app once, then share the recording again.");
  const target = new URL(query.size ? `/inbox?${query}` : "/inbox", request.url);
  return Response.redirect(target, 303);
}
