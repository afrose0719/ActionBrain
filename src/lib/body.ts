// Reads a request body with a hard BYTE limit, so a huge or endless body is refused (413) before it is parsed.
// Content-Length is checked first (cheap), then the stream is counted as it arrives, because the header can lie or be absent.

export type BodyResult<T> = { ok: true; value: T } | { ok: false; response: Response };

export const LIMITS = {
  small: 16 * 1024, // settings, connect, search questions
  medium: 64 * 1024, // inbox analyze, command box, waiting summary
  large: 256 * 1024, // meeting transcripts (30,000 characters; Tamil or Hindi text is about 3 bytes per character)
} as const;

function tooLarge(maxBytes: number) {
  return Response.json({ error: `Request too large (limit ${Math.round(maxBytes / 1024)} KB).` }, { status: 413 });
}

export async function readTextBody(request: Request, maxBytes: number): Promise<BodyResult<string>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: tooLarge(maxBytes) };
  if (!request.body) return { ok: true, value: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, response: tooLarge(maxBytes) };
      }
      chunks.push(value);
    }
  } catch {
    // the client went away or the stream broke: treat it as an unreadable request, never a server crash
    return { ok: false, response: Response.json({ error: "Could not read the request." }, { status: 400 }) };
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(all) };
}

/** JSON body, or null when it is not valid JSON (the routes already answer 400 for a missing field). Oversized → 413. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers check every field's type themselves, as they did with request.json()
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult<any>> {
  const text = await readTextBody(request, maxBytes);
  if (!text.ok) return text;
  try {
    const parsed: unknown = JSON.parse(text.value);
    return { ok: true, value: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null };
  } catch {
    return { ok: true, value: null };
  }
}
