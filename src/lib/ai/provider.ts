// One function, three providers. Pick one with AI_PROVIDER in .env.local.
// Keys stay on the server (no NEXT_PUBLIC_ prefix), so the browser never sees them.

const DEFAULT_MODELS = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
} as const;

type Provider = keyof typeof DEFAULT_MODELS;

export function isConfigured(): boolean {
  const p = (process.env.AI_PROVIDER ?? "anthropic") as Provider;
  const key = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" }[p];
  return !!key && !!process.env[key];
}

/** Sends a prompt and returns the model's text reply. */
export async function askModel(system: string, user: string): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? "anthropic") as Provider;
  if (!(provider in DEFAULT_MODELS)) throw new Error(`Unknown AI_PROVIDER "${provider}".`);
  const model = process.env.AI_MODEL || DEFAULT_MODELS[provider];

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: 800, system, messages: [{ role: "user", content: user }] }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? `Anthropic error ${res.status}`);
    return body.content?.[0]?.text ?? "";
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? `OpenAI error ${res.status}`);
    return body.choices?.[0]?.message?.content ?? "";
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Gemini error ${res.status}`);
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
