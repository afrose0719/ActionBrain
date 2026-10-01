import { int16ToFloat, isSilent, joinTranscripts, planSegments } from "./audio.ts";
import type { Device, WhisperModel } from "./whisper/protocol.ts";

/** The part of the Whisper client this needs. Written as an interface so tests can swap in a fake. */
export type Engine = {
  load(model: WhisperModel, onProgress?: (percent: number) => void, device?: Device): Promise<void>;
  transcribe(audio: Float32Array, language: string | null): Promise<string>;
  dispose(): void;
};

export type TranscribeOptions = {
  model: WhisperModel;
  language: string | null;
  /** Where to try first. If "webgpu" fails for any reason, the whole job restarts on the processor. */
  device: Device;
  createEngine: () => Engine;
  /** Called when the download of the model starts, and when transcribing starts. */
  onPhase?: (phase: "downloading" | "transcribing", device: Device) => void;
  onPercent?: (percent: number) => void;
  onStep?: (step: string) => void;
  isCancelled?: () => boolean;
  /** Lets the caller stop the engine mid-job (for a Cancel button). */
  onEngine?: (engine: Engine | null) => void;
};

/**
 * Turns 16 kHz mono audio into a transcript, on this device.
 * Used for both a live recording and an imported call recording, so they behave identically.
 */
export async function transcribeSamples(samples: Int16Array, opts: TranscribeOptions): Promise<string> {
  const attempt = async (device: Device): Promise<string> => {
    const engine = opts.createEngine();
    opts.onEngine?.(engine);
    try {
      opts.onPhase?.("downloading", device);
      opts.onPercent?.(0);
      await engine.load(opts.model, opts.onPercent, device);

      opts.onPhase?.("transcribing", device);
      const segments = planSegments(samples);
      const parts: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        if (opts.isCancelled?.()) throw new Error("Cancelled.");
        opts.onStep?.(`Part ${i + 1} of ${segments.length}`);
        opts.onPercent?.(Math.round((i / segments.length) * 100));
        const [from, to] = segments[i];
        const audio = int16ToFloat(samples.subarray(from, to));
        parts.push(isSilent(audio) ? "" : await engine.transcribe(audio, opts.language)); // Whisper makes up words for silence
      }
      return joinTranscripts(parts);
    } finally {
      engine.dispose(); // frees the model's memory; a failed attempt must leave nothing half-started
      opts.onEngine?.(null);
    }
  };

  try {
    return await attempt(opts.device);
  } catch (e) {
    if (opts.device === "wasm" || opts.isCancelled?.()) throw e;
    return attempt("wasm"); // the graphics card did not work out: start over on the processor, with a fresh engine
  }
}
