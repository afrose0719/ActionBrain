import { createClient } from "@supabase/supabase-js";
import { eventIdFromHeaders, readNotification, tokenFromHeaders } from "@/lib/intake";
import { readTextBody } from "@/lib/body";

// POST /api/intake   (called by an automation app on your phone, NOT by the website)
//   Header:  Authorization: Bearer abi_...   (or x-actionbrain-token)
//   Body:    plain text, first line = who it is from, the rest = the message   (or JSON {"title","text"})
//   Optional header: x-actionbrain-event-id: <8-64 chars>   (a retry with the same id answers "duplicate"; Milestone 28 SQL)
// Answers {"status": "stored" | "duplicate" | "ignored" | "limit"} or an error. It never returns anyone's data.

const MAX_BODY = 8_000;

export async function POST(request: Request) {
  const token = tokenFromHeaders(request.headers);
  if (!token) return Response.json({ error: "Missing or malformed token." }, { status: 401 });
  const eventId = eventIdFromHeaders(request.headers);
  if (eventId === null) return Response.json({ error: "Malformed x-actionbrain-event-id (8-64 letters, digits, - or _)." }, { status: 400 });

  // bytes are capped while reading (an endless body is cut off early); characters are capped after, as before
  const read = await readTextBody(request, MAX_BODY * 4);
  if (!read.ok) return read.response;
  const raw = read.value;
  if (raw.length > MAX_BODY) return Response.json({ error: "Message too large." }, { status: 413 });

  const parsed = readNotification(request.headers.get("content-type"), raw);
  if (!parsed.ok) {
    // Nothing worth keeping (a system notification, a photo, an empty body). Not an error: the phone should not retry.
    return Response.json({ status: "ignored", reason: parsed.reason }, { status: parsed.reason === "invalid" ? 400 : 200 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("ingest_message", {
    p_token: token,
    p_sender: parsed.message.sender,
    p_text: parsed.message.text,
    p_group: parsed.message.group,
    // sent only when true, so a database that has not had the Milestone 24 SQL yet keeps working for ordinary messages
    ...(parsed.message.mine ? { p_mine: true } : {}),
    // likewise only for Teams: WhatsApp keeps working against a database without the Milestone 27 SQL
    ...(parsed.message.source === "teams" ? { p_source: "teams" } : {}),
    // only when the phone sent one, so a database without the Milestone 28 SQL keeps working for phones that do not
    ...(eventId ? { p_event_id: eventId } : {}),
  });
  if (error) return Response.json({ error: "Could not save the message." }, { status: 502 });
  if (data === "invalid") return Response.json({ error: "That token is not valid. Create a new one in Settings." }, { status: 401 });
  return Response.json({ status: data }, { headers: { "Cache-Control": "no-store" } });
}
