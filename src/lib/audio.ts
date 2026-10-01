// Audio helpers for call recording and local Whisper transcription. Pure functions: no browser APIs, so they are unit-tested.

/** Whisper only understands 16,000 samples per second, mono. */
export const WHISPER_RATE = 16000;

/**
 * Converts audio from the microphone's rate (usually 44.1 or 48 kHz) to 16 kHz, a little at a time as it arrives.
 * It remembers where it stopped, so there is no click or gap where one chunk meets the next.
 */
export function createResampler(fromRate: number, toRate = WHISPER_RATE) {
  if (fromRate <= 0 || toRate <= 0) throw new Error("Sample rates must be positive.");
  const ratio = fromRate / toRate;
  let leftover = new Float32Array(0);
  let phase = 0; // how far into `leftover` the next output sample sits (can be fractional)

  return {
    push(chunk: Float32Array): Float32Array {
      if (ratio === 1) return chunk;
      const input = new Float32Array(leftover.length + chunk.length);
      input.set(leftover);
      input.set(chunk, leftover.length);

      const out: number[] = [];
      let pos = phase;
      while (pos + 1 < input.length) {
        const i = Math.floor(pos);
        const f = pos - i;
        out.push(input[i] * (1 - f) + input[i + 1] * f); // blend the two nearest input samples
        pos += ratio;
      }
      const consumed = Math.min(Math.floor(pos), input.length);
      leftover = input.slice(consumed);
      phase = pos - consumed;
      return Float32Array.from(out);
    },
  };
}

/** Float samples (-1..1) to compact 16-bit integers: half the memory, which matters for long calls. */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function int16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / (samples[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

export function mergeInt16(chunks: Int16Array[]): Int16Array {
  const out = new Int16Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Loudness in dB relative to full scale: 0 is the loudest possible, about -20 is normal speech, -100 is silence. */
export function rmsDb(samples: Float32Array | Int16Array): number {
  if (samples.length === 0) return -100;
  const scale = samples instanceof Int16Array ? 0x8000 : 1;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / scale;
    sum += v * v;
  }
  const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-5);
  return Math.max(-100, db);
}

/** True if a stretch of audio is just room noise. Whisper invents words ("Thank you for watching") for silence, so skip these. */
export function isSilent(samples: Float32Array | Int16Array, thresholdDb = -50): boolean {
  return rmsDb(samples) < thresholdDb;
}

/**
 * Splits a long recording into pieces of about `targetSec` seconds for transcription.
 * Each cut is moved to the quietest moment near the target (up to `searchSec` before it, half that after), so words are not sliced in half.
 * Returns [start, end) sample ranges that cover the whole recording with no gaps and no overlap.
 */
export function planSegments(samples: Int16Array, rate = WHISPER_RATE, targetSec = 180, searchSec = 10): [number, number][] {
  const total = samples.length;
  const target = Math.max(1, Math.round(targetSec * rate));
  const search = Math.round(searchSec * rate);
  const win = Math.round(0.1 * rate); // look at 100 ms at a time
  const ranges: [number, number][] = [];
  let start = 0;

  while (start < total) {
    let end = start + target;
    if (end >= total - search) {
      end = total; // the last piece absorbs a short remainder instead of leaving a tiny fragment
    } else {
      let bestAt = end;
      let bestEnergy = Infinity;
      // look for the quietest moment around the target: mostly just before it, and a little after
      const lookUntil = Math.min(end + Math.floor(search / 2), total);
      for (let w = end - search; w + win <= lookUntil; w += win) {
        let e = 0;
        for (let i = w; i < w + win; i++) e += samples[i] * samples[i];
        if (e < bestEnergy) {
          bestEnergy = e;
          bestAt = w + Math.floor(win / 2);
        }
      }
      end = bestAt;
    }
    ranges.push([start, end]);
    start = end;
  }
  return ranges;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// Things Whisper writes for non-speech, or invents when it hears nothing.
const NON_SPEECH = /\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)\]|\((?:music|silence|noise|inaudible|applause)\)|♪+/gi;
const PHANTOM_ONLY = /^(?:thank you\.?|thanks\.?|thanks for watching[.!]?|thank you for watching[.!]?|you|bye\.?)$/i;

/** Tidies one piece of Whisper output. Returns "" when it was only a noise tag or a typical made-up phrase. */
export function cleanWhisperText(text: string): string {
  const t = text.replace(NON_SPEECH, " ").replace(/\s+/g, " ").trim();
  return PHANTOM_ONLY.test(t) ? "" : t;
}

/** Joins the text of each segment into one transcript, one paragraph per segment. */
export function joinTranscripts(parts: string[]): string {
  return parts.map(cleanWhisperText).filter(Boolean).join("\n\n");
}
