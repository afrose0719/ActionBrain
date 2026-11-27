import { getUserClient } from "@/lib/server-auth";
import { decrypt } from "@/lib/crypto";
import { askModel, isProvider } from "@/lib/ai/provider";
import { validateCommitments, validateSuggestions } from "@/lib/ai/actions";
import { LIMITS, readJsonBody } from "@/lib/body";
import { INBOX_SYSTEM_PROMPT } from "@/lib/ai/prompts";

// the prompt lives in src/lib/ai/prompts.ts so background processing (zero-touch) uses exactly the same one
const SYSTEM_PROMPT = INBOX_SYSTEM_PROMPT;

export async function POST(request: Request) {
  const auth = await getUserClient(request);
  if (!auth) return Response.json({ error: "Not logged in." }, { status: 401 });

  const { data: settings } = await auth.supabase
    .from("user_ai_settings")
    .select("provider, model, encrypted_key")
    .maybeSingle();
  if (!settings || !isProvider(settings.provider)) {
    return Response.json({ error: "Add your AI provider key in Settings first.", code: "NO_KEY" }, { status: 400 });
  }
  let apiKey: string;
  try {
    apiKey = decrypt(settings.encrypted_key);
  } catch {
    return Response.json(
      { error: "Your saved key could not be read. Please save it again in Settings.", code: "NO_KEY" },
      { status: 400 }
    );
  }

  const read = await readJsonBody(request, LIMITS.medium);
  if (!read.ok) return read.response;
  const body = read.value;
  const content = typeof body?.content === "string" ? body.content.trim().slice(0, 6000) : "";
  if (!content) return Response.json({ error: "There is no text to analyze." }, { status: 400 });
  const now = typeof body?.now === "string" ? body.now : new Date().toISOString();
  const timeZone = typeof body?.timeZone === "string" ? body.timeZone : "UTC";

  const meta = auth.user.user_metadata as { full_name?: string } | undefined;
  const userName = meta?.full_name?.trim() || auth.user.email?.split("@")[0] || "the user";

  try {
    const reply = await askModel(
      { provider: settings.provider, model: settings.model, apiKey },
      SYSTEM_PROMPT,
      `The USER is: ${userName} (${auth.user.email ?? "no email"})\nCurrent time: ${now}\nTimezone: ${timeZone}\n\nMessage:\n<<<\n${content}\n>>>`
    );
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
    } catch {
      /* fall through: no suggestions */
    }
    return Response.json({ suggestions: validateSuggestions(parsed), commitments: validateCommitments(parsed) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "AI request failed." }, { status: 502 });
  }
}
