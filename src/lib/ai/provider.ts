// One function, three providers. The API key belongs to the logged-in user and is passed in per call.

export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", defaultModel: "claude-haiku-4-5-20251001" },
  openai: { label: "OpenAI", defaultModel: "gpt-4o-mini" },
  gemini: { label: "Google Gemini", defaultModel: "gemini-2.0-flash" },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export function isProvider(v: unknown): v is ProviderId {
  return typeof v === "string" && v in PROVIDERS;
}

export type AiConfig = { provider: ProviderId; model?: string | null; apiKey: string };

/** Sends a prompt and returns the model's text reply. */
export async function askModel(config: AiConfig, system: string, user: string): Promise<string> {
  const { provider, apiKey } = config;
  const model = config.model || PROVIDERS[provider].defaultModel;

  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 800, system, messages: [{ role: "user", content: user }] }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? `Anthropic error ${res.status}`);
    return body.content?.[0]?.text ?? "";
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
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

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? `Gemini error ${res.status}`);
  return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}
