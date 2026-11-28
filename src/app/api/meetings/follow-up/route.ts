import { getUserClient } from "@/lib/server-auth";
import { decrypt } from "@/lib/crypto";
import { askModel, isProvider } from "@/lib/ai/provider";
import { LIMITS, readJsonBody } from "@/lib/body";
import { FOLLOW_UP_PROMPT, validateFollowUp } from "@/lib/follow-up";

// Drafts a follow-up email from a meeting's notes, with the user's own AI key. Nothing is stored or sent.
export async function POST(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const { data: settings } = await auth.supabase.from("user_ai_settings").select("provider, model, encrypted_key").maybeSingle();
  if (!settings || !isProvider(settings.provider)) {
    return Response.json({ error: "Add your AI provider key in Settings first.", code: "NO_KEY" }, { status: 400 });
  }
  let apiKey: string;
  try {
    apiKey = decrypt(settings.encrypted_key);
  } catch {
    return Response.json({ error: "Your saved key could not be read. Please save it again in Settings.", code: "NO_KEY" }, { status: 400 });
  }

  const read = await readJsonBody(request, LIMITS.medium);
  if (!read.ok) return read.response;
  const notes = typeof read.value?.notes === "string" ? read.value.notes.trim().slice(0, 8000) : "";
  if (!notes) return Response.json({ error: "This meeting has no notes yet. Analyze it first." }, { status: 400 });

  const meta = auth.user.user_metadata as { full_name?: string } | undefined;
  const userName = meta?.full_name?.trim() || auth.user.email?.split("@")[0] || "the user";

  try {
    const reply = await askModel(
      { provider: settings.provider, model: settings.model, apiKey },
      FOLLOW_UP_PROMPT,
      `The USER (the sender) is: ${userName}\n\nMeeting notes:\n<<<\n${notes}\n>>>`,
      { maxTokens: 800 }
    );
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
    } catch {
      return Response.json({ error: "The AI gave an unreadable answer. Try again." }, { status: 502 });
    }
    const draft = validateFollowUp(parsed);
    if (!draft) return Response.json({ error: "The AI did not write a usable email. Try again." }, { status: 502 });
    return Response.json(draft);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "AI request failed." }, { status: 502 });
  }
}
