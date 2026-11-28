import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRequest, effectiveEngine, transcribeInCloud, wavBlob, CloudSpeechError } from "../src/lib/cloud-speech.ts";

const RATE = 16000;
/** Speech-like audio with a quiet gap every 5 seconds, so there are good places to cut. */
function audio(seconds: number): Int16Array {
  const s = new Int16Array(seconds * RATE);
  for (let i = 0; i < s.length; i++) s[i] = (i / RATE) % 5 < 4.5 ? Math.round(8000 * Math.sin(i / 7)) : 0;
  return s;
}

test("the WAV file is 16 kHz mono 16-bit with a correct header", async () => {
  const blob = wavBlob(new Int16Array([1, -1, 300]));
  const b = new DataView(await blob.arrayBuffer());
  assert.equal(blob.size, 44 + 6);
  assert.equal(String.fromCharCode(b.getUint8(0), b.getUint8(1), b.getUint8(2), b.getUint8(3)), "RIFF");
  assert.equal(b.getUint32(24, true), 16000);
  assert.equal(b.getUint16(22, true), 1);
  assert.equal(b.getUint32(40, true), 6);
  assert.equal(b.getInt16(48, true), 300);
});

test("Sarvam: saaras:v4 in codemix mode, the key in its own header, Tamil mapped to ta-IN, auto-detect otherwise", () => {
  const r = buildRequest("sarvam", "sk_1", wavBlob(new Int16Array(10)), "tamil");
  const form = r.init.body as FormData;
  assert.equal(r.url, "https://api.sarvam.ai/speech-to-text");
  assert.deepEqual(r.init.headers, { "api-subscription-key": "sk_1" });
  assert.equal(form.get("model"), "saaras:v4");
  assert.equal(form.get("mode"), "codemix");
  assert.equal(form.get("language_code"), "ta-IN");
  assert.equal((buildRequest("sarvam", "k", wavBlob(new Int16Array(1)), null).init.body as FormData).get("language_code"), "unknown");
});

test("OpenAI: gpt-transcribe (the older models shut down in 2027), bearer key, language only when chosen", () => {
  const r = buildRequest("openai", "sk-2", wavBlob(new Int16Array(10)), "hindi");
  const form = r.init.body as FormData;
  assert.equal(r.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.deepEqual(r.init.headers, { Authorization: "Bearer sk-2" });
  assert.equal(form.get("model"), "gpt-transcribe");
  assert.equal(form.get("language"), "hi");
  assert.equal((buildRequest("openai", "k", wavBlob(new Int16Array(1)), null).init.body as FormData).get("language"), null);
});

type Call = { url: string; seconds: number };
function fakeFetch(reply: (n: number) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const file = (init.body as FormData).get("file") as Blob;
    calls.push({ url, seconds: (file.size - 44) / 2 / RATE });
    const { status, body } = reply(calls.length);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

test("a long call goes to Sarvam in clips under 30 seconds and the text is joined in order", async () => {
  const f = fakeFetch((n) => ({ status: 200, body: { transcript: `part ${n}` } }));
  const percents: number[] = [];
  const text = await transcribeInCloud(audio(130), { engine: "sarvam", key: "k", language: null, fetchImpl: f.impl, onPercent: (p) => percents.push(p) });
  assert.ok(f.calls.length >= 5);
  for (const c of f.calls) assert.ok(c.seconds < 30, `clip of ${c.seconds}s`);
  assert.equal(Math.round(f.calls.reduce((s, c) => s + c.seconds, 0)), 130, "no audio lost or repeated");
  assert.equal(text, f.calls.map((_, i) => `part ${i + 1}`).join("\n\n"));
  assert.equal(percents.at(-1), 100);
});

test("OpenAI gets few, large clips (under its 25 MB limit)", async () => {
  const f = fakeFetch(() => ({ status: 200, body: { text: "ok" } }));
  await transcribeInCloud(audio(25 * 60), { engine: "openai", key: "k", language: null, fetchImpl: f.impl });
  assert.equal(f.calls.length, 3);
  for (const c of f.calls) assert.ok(c.seconds * RATE * 2 + 44 < 25 * 1024 * 1024);
});

test("busy (429) is retried once; a refused key gives a clear message", async () => {
  const busy = fakeFetch((n) => (n === 1 ? { status: 429, body: "slow down" } : { status: 200, body: { transcript: "ok" } }));
  assert.equal(await transcribeInCloud(audio(10), { engine: "sarvam", key: "k", language: null, fetchImpl: busy.impl, wait: async () => {} }), "ok");
  assert.equal(busy.calls.length, 2);
  const refused = fakeFetch(() => ({ status: 403, body: "invalid key" }));
  await assert.rejects(
    transcribeInCloud(audio(10), { engine: "sarvam", key: "bad", language: null, fetchImpl: refused.impl }),
    (e: unknown) => e instanceof CloudSpeechError && /Sarvam refused the key/.test(e.message)
  );
});

test("a cloud engine is used only when its key is there; otherwise on-device", () => {
  assert.equal(effectiveEngine({ engine: "sarvam", keys: { sarvam: "k" } }), "sarvam");
  assert.equal(effectiveEngine({ engine: "sarvam", keys: { sarvam: "  " } }), "local");
  assert.equal(effectiveEngine({ engine: "openai", keys: { sarvam: "k" } }), "local");
  assert.equal(effectiveEngine({ engine: "local", keys: { openai: "k" } }), "local");
});

test("the audio and key never go through ActionBrain's server", () => {
  const src = readFileSync("src/lib/cloud-speech.ts", "utf8");
  assert.ok(!/authFetch|\/api\//.test(src), "no ActionBrain API call");
  const recorder = readFileSync("src/components/call-recorder.tsx", "utf8");
  assert.ok(recorder.includes("Using the on-device engine instead"), "falls back instead of losing the call");
});
