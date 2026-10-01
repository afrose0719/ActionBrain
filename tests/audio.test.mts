import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WHISPER_RATE,
  cleanWhisperText,
  createResampler,
  floatToInt16,
  formatDuration,
  int16ToFloat,
  isSilent,
  joinTranscripts,
  mergeInt16,
  planSegments,
  rmsDb,
} from "../src/lib/audio.ts";

const tone = (seconds: number, rate: number, hz = 440, amp = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate));

/** Dominant frequency of a signal, by counting upward zero crossings. */
const frequency = (s: Float32Array, rate: number) => {
  let crossings = 0;
  for (let i = 1; i < s.length; i++) if (s[i - 1] < 0 && s[i] >= 0) crossings++;
  return crossings / (s.length / rate);
};

// ---------------- resampling ----------------

test("48 kHz becomes 16 kHz with one third as many samples and the same pitch", () => {
  const out = createResampler(48000).push(tone(2, 48000, 440));
  assert.ok(Math.abs(out.length - 2 * WHISPER_RATE) <= 2, `got ${out.length} samples`);
  assert.ok(Math.abs(frequency(out, WHISPER_RATE) - 440) < 3);
});

test("44.1 kHz (not a whole multiple of 16 kHz) still lands on the right length and pitch", () => {
  const out = createResampler(44100).push(tone(3, 44100, 300));
  assert.ok(Math.abs(out.length - 3 * WHISPER_RATE) <= 2, `got ${out.length} samples`);
  assert.ok(Math.abs(frequency(out, WHISPER_RATE) - 300) < 3);
});

test("feeding audio in many small chunks gives the same result as one big chunk (no clicks at the joins)", () => {
  const input = tone(1.5, 44100, 500);
  const whole = createResampler(44100).push(input);

  const r = createResampler(44100);
  const parts: Float32Array[] = [];
  for (let i = 0; i < input.length; i += 1000) parts.push(r.push(input.subarray(i, Math.min(i + 1000, input.length))));
  const stitched = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    stitched.set(p, at);
    at += p.length;
  }

  assert.ok(Math.abs(stitched.length - whole.length) <= 2);
  const n = Math.min(stitched.length, whole.length);
  let worst = 0;
  for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(stitched[i] - whole[i]));
  assert.ok(worst < 1e-4, `chunked output differs by ${worst}`);
});

test("already 16 kHz is passed through untouched; bad rates are rejected; empty input is fine", () => {
  const a = tone(0.1, 16000);
  assert.equal(createResampler(16000).push(a), a);
  assert.throws(() => createResampler(0));
  assert.equal(createResampler(48000).push(new Float32Array(0)).length, 0);
});

// ---------------- conversions ----------------

test("float to 16-bit and back loses almost nothing, and clipping is clamped", () => {
  const src = tone(0.05, 16000, 200, 0.8);
  const back = int16ToFloat(floatToInt16(src));
  let worst = 0;
  for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(src[i] - back[i]));
  assert.ok(worst < 1e-3);
  assert.deepEqual([...floatToInt16(Float32Array.from([2, -2, 0]))], [32767, -32768, 0]);
});

test("mergeInt16 joins chunks in order", () => {
  assert.deepEqual([...mergeInt16([Int16Array.from([1, 2]), Int16Array.from([]), Int16Array.from([3])])], [1, 2, 3]);
});

// ---------------- loudness and silence ----------------

test("loudness in dB: full scale is 0, speech-like is around -20, silence is -100", () => {
  assert.ok(Math.abs(rmsDb(Float32Array.from({ length: 1000 }, () => 1))) < 0.01);
  assert.ok(Math.abs(rmsDb(tone(0.2, 16000, 440, 0.1 * Math.SQRT2)) - -20) < 0.5);
  assert.equal(rmsDb(new Float32Array(1000)), -100);
  assert.equal(rmsDb(new Float32Array(0)), -100);
});

test("room noise counts as silence, speech-level audio does not", () => {
  assert.equal(isSilent(tone(1, 16000, 200, 0.001)), true); // about -57 dB
  assert.equal(isSilent(tone(1, 16000, 200, 0.2)), false);
  assert.equal(isSilent(floatToInt16(tone(1, 16000, 200, 0.2))), false); // works on 16-bit data too
});

// ---------------- segmenting a long recording ----------------

/** loud tone, with a quiet gap (silence) at each of the given times (in seconds) */
function recordingWithGaps(seconds: number, gapsAt: number[], gapLen = 0.3): Int16Array {
  const s = floatToInt16(tone(seconds, WHISPER_RATE, 220, 0.5));
  for (const g of gapsAt) s.fill(0, Math.round(g * WHISPER_RATE), Math.round((g + gapLen) * WHISPER_RATE));
  return s;
}

test("a recording shorter than one segment stays whole", () => {
  assert.deepEqual(planSegments(recordingWithGaps(60, []), WHISPER_RATE, 180), [[0, 60 * WHISPER_RATE]]);
  assert.deepEqual(planSegments(new Int16Array(0)), []);
});

test("segments cover everything exactly once, with no gaps or overlaps", () => {
  const rec = recordingWithGaps(600, [172, 355, 530]);
  const segs = planSegments(rec, WHISPER_RATE, 180, 10);
  assert.ok(segs.length >= 3);
  assert.equal(segs[0][0], 0);
  assert.equal(segs.at(-1)![1], rec.length);
  for (let i = 1; i < segs.length; i++) assert.equal(segs[i][0], segs[i - 1][1]);
});

test("cuts are made in a silent gap, not through a word", () => {
  const rec = recordingWithGaps(600, [172, 352, 532]); // quiet gaps just before 180s, 360s, 540s
  const segs = planSegments(rec, WHISPER_RATE, 180, 10);
  for (const [, end] of segs.slice(0, -1)) {
    const around = rec.subarray(end - 800, end + 800); // 100 ms around the cut
    assert.ok(isSilent(around), `cut at ${(end / WHISPER_RATE).toFixed(1)}s is in loud audio`);
  }
});

test("a short remainder is merged into the last segment instead of becoming a tiny fragment", () => {
  const segs = planSegments(recordingWithGaps(185, []), WHISPER_RATE, 180, 10);
  assert.equal(segs.length, 1);
});

// ---------------- text clean-up ----------------

test("duration formatting", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3599), "59:59");
  assert.equal(formatDuration(3661), "1:01:01");
  assert.equal(formatDuration(-5), "0:00");
});

test("noise tags and typical made-up phrases are removed, real speech is kept", () => {
  assert.equal(cleanWhisperText(" [BLANK_AUDIO] "), "");
  assert.equal(cleanWhisperText("Thank you."), "");
  assert.equal(cleanWhisperText("Thanks for watching!"), "");
  assert.equal(cleanWhisperText("(music) Hello there ♪♪"), "Hello there");
  assert.equal(cleanWhisperText("Thank you for sending the report, I will review it tomorrow."), "Thank you for sending the report, I will review it tomorrow.");
  assert.equal(cleanWhisperText("  lots   of\n spaces "), "lots of spaces");
});

test("segments are joined into paragraphs, skipping empty ones", () => {
  assert.equal(joinTranscripts(["First part.", "[BLANK_AUDIO]", " Second part. ", ""]), "First part.\n\nSecond part.");
  assert.equal(joinTranscripts([]), "");
});
