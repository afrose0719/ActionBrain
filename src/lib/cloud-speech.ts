// Cloud speech engines with the customer's OWN key (Milestone 36), for mixed Tamil/Hindi/English meetings where the on-device
// Whisper is weaker. The audio goes straight from this device to the provider the customer chose; it never passes through
// ActionBrain's server, and the key is kept only in this browser. The on-device Whisper stays the default.

import { joinTranscripts, planSegments, WHISPER_RATE } from "./audio.ts";
import { getSecret, migrateSecret, setSecret } from "./secret-store.ts";

export type SpeechEngine = "local" | "sarvam" | "openai";

export const ENGINES: Record<SpeechEngine, { label: string; note: string; keyHelp?: string; maxSec: number }> = {
  local: { label: "On this device (Whisper)", note: "Free and private: nothing leaves this device.", maxSec: Infinity },
  sarvam: {
    label: "Sarvam (best for Tamil/Hindi mixed with English)",
    note: "Uses your own Sarvam key. The audio goes from this device to Sarvam, not to ActionBrain.",
    keyHelp: "Get a key at dashboard.sarvam.ai",
    maxSec: 25, // Sarvam's quick API takes clips under 30 seconds
  },
  openai: {
    label: "OpenAI (gpt-transcribe)",
    note: "Uses your own OpenAI key. The audio goes from this device to OpenAI, not to ActionBrain.",
    keyHelp: "Get a key at platform.openai.com",
    maxSec: 600, // 10 minutes of 16 kHz WAV is about 19 MB, under OpenAI's 25 MB limit
  },
};

const SARVAM_LANG: Record<string, string> = {
  english: "en-IN",
  hindi: "hi-IN",
  tamil: "ta-IN",
  telugu: "te-IN",
  malayalam: "ml-IN",
  kannada: "kn-IN",
  marathi: "mr-IN",
  bengali: "bn-IN",
  gujarati: "gu-IN",
  urdu: "ur-IN",
};
const OPENAI_LANG: Record<string, string> = {
  english: "en", hindi: "hi", tamil: "ta", telugu: "te", malayalam: "ml", kannada: "kn", marathi: "mr", bengali: "bn",
  gujarati: "gu", urdu: "ur", spanish: "es", french: "fr", german: "de", arabic: "ar",
};

/** 16 kHz mono 16-bit samples as a WAV file. */
export function wavBlob(samples: Int16Array, rate = WHISPER_RATE): Blob {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.byteLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.byteLength, true);
  const body = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength).slice();
  return new Blob([header, body], { type: "audio/wav" });
}

/** The request for one clip, for each provider. Separate so tests can check exactly what is sent. */
export function buildRequest(engine: "sarvam" | "openai", key: string, clip: Blob, language: string | null): { url: string; init: RequestInit } {
  const form = new FormData();
  form.append("file", clip, "clip.wav");
  if (engine === "sarvam") {
    form.append("model", "saaras:v4");
    // "codemix": English words stay in English, Tamil/Hindi words in their own script, as people actually speak
    form.append("mode", "codemix");
    form.append("language_code", (language && SARVAM_LANG[language]) || "unknown");
    return { url: "https://api.sarvam.ai/speech-to-text", init: { method: "POST", headers: { "api-subscription-key": key }, body: form } };
  }
  form.append("model", "gpt-transcribe");
  const lang = language && OPENAI_LANG[language];
  if (lang) form.append("language", lang);
  form.append("response_format", "json");
  return { url: "https://api.openai.com/v1/audio/transcriptions", init: { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form } };
}

export class CloudSpeechError extends Error {}

function explain(engine: string, status: number, detail: string): string {
  const name = engine === "sarvam" ? "Sarvam" : "OpenAI";
  if (status === 401 || status === 403) return `${name} refused the key. Check the key in the recorder's speech settings.`;
  if (status === 429) return `${name} says too many requests or no credit left. Try again later, or switch to "On this device".`;
  return `${name} could not transcribe the audio (${status}${detail ? `: ${detail.slice(0, 120)}` : ""}).`;
}

/**
 * Sends the recording to the chosen provider in clips (cut at quiet moments) and joins the text.
 * Retries a clip once after a short wait if the provider is busy. Nothing is stored anywhere.
 */
export async function transcribeInCloud(
  samples: Int16Array,
  opts: {
    engine: "sarvam" | "openai";
    key: string;
    language: string | null;
    fetchImpl?: typeof fetch;
    onPercent?: (p: number) => void;
    isCancelled?: () => boolean;
    wait?: (ms: number) => Promise<void>;
  }
): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const wait = opts.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const { maxSec } = ENGINES[opts.engine];
  const ranges = planSegments(samples, WHISPER_RATE, maxSec - 4, Math.min(4, maxSec / 5));
  const parts: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    if (opts.isCancelled?.()) throw new CloudSpeechError("Cancelled.");
    const [a, b] = ranges[i];
    const { url, init } = buildRequest(opts.engine, opts.key, wavBlob(samples.subarray(a, b)), opts.language);
    let res = await doFetch(url, init);
    if (res.status === 429 || res.status >= 500) {
      await wait(3000);
      res = await doFetch(url, buildRequest(opts.engine, opts.key, wavBlob(samples.subarray(a, b)), opts.language).init);
    }
    if (!res.ok) throw new CloudSpeechError(explain(opts.engine, res.status, await res.text().catch(() => "")));
    const body = (await res.json().catch(() => ({}))) as { transcript?: unknown; text?: unknown };
    const text = opts.engine === "sarvam" ? body.transcript : body.text;
    parts.push(typeof text === "string" ? text : "");
    opts.onPercent?.(Math.round(((i + 1) / ranges.length) * 100));
  }
  return joinTranscripts(parts);
}

// ---------------- the choice and the keys: only in this browser ----------------

const STORE = "actionbrain.speech";
/** remember: keep the keys after the browser is closed (otherwise only for this browser session). */
export type SpeechPrefs = { engine: SpeechEngine; keys: { sarvam?: string; openai?: string }; remember?: boolean };

export function loadSpeechPrefs(): SpeechPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "null");
    const engine: SpeechEngine = raw?.engine === "sarvam" || raw?.engine === "openai" ? raw.engine : "local";
    // keys saved by the first version lived inside this object: move them to the secret store once
    migrateSecret("sarvam", raw?.keys?.sarvam);
    migrateSecret("openai", raw?.keys?.openai);
    if (raw?.keys) localStorage.setItem(STORE, JSON.stringify({ engine, remember: true }));
    const sarvam = getSecret("sarvam");
    const openai = getSecret("openai");
    return {
      engine,
      keys: { sarvam: sarvam.value || undefined, openai: openai.value || undefined },
      remember: raw?.remember === true || sarvam.remembered || openai.remembered,
    };
  } catch {
    return { engine: "local", keys: {} };
  }
}

export function saveSpeechPrefs(p: SpeechPrefs) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ engine: p.engine, remember: Boolean(p.remember) })); // never the keys
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  setSecret("sarvam", p.keys.sarvam ?? "", Boolean(p.remember));
  setSecret("openai", p.keys.openai ?? "", Boolean(p.remember));
}

/** The engine to actually use: a cloud engine only when its key is there. */
export function effectiveEngine(p: SpeechPrefs): SpeechEngine {
  if (p.engine === "sarvam" && p.keys.sarvam?.trim()) return "sarvam";
  if (p.engine === "openai" && p.keys.openai?.trim()) return "openai";
  return "local";
}
