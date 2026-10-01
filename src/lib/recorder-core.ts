import { createResampler, floatToInt16, mergeInt16, rmsDb, WHISPER_RATE } from "./audio.ts";

export type Capture = {
  /** Stops listening and returns everything heard, as 16 kHz mono 16-bit audio. */
  stop(): Promise<{ samples: Int16Array; durationSec: number }>;
};

/**
 * Listens to an audio stream and keeps it in memory, already converted to what Whisper needs.
 * Nothing is uploaded or saved: the audio exists only in this page until it has been turned into text.
 * Works with any MediaStream, so it can be tested without a real microphone.
 */
export async function startCapture(
  stream: MediaStream,
  options: { onLevel?: (db: number) => void; maxSeconds?: number; onLimit?: () => void } = {}
): Promise<Capture> {
  const { onLevel, maxSeconds = 3600, onLimit } = options;

  const ctx = new AudioContext();
  await ctx.resume(); // browsers start audio "suspended" until the page has had a click
  await ctx.audioWorklet.addModule("/recorder-worklet.js");

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture");
  const mute = ctx.createGain();
  mute.gain.value = 0; // the graph must reach the speakers for the browser to run it, but we never want to play the audio back
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  const resampler = createResampler(ctx.sampleRate, WHISPER_RATE);
  const chunks: Int16Array[] = [];
  let total = 0;
  const maxSamples = maxSeconds * WHISPER_RATE;
  let limitReported = false;

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const frame = event.data;
    onLevel?.(rmsDb(frame));
    if (total >= maxSamples) {
      if (!limitReported) {
        limitReported = true;
        onLimit?.();
      }
      return; // keep what we have; ignore anything past the limit
    }
    const pcm = floatToInt16(resampler.push(frame));
    chunks.push(pcm);
    total += pcm.length;
  };

  let stopped = false;
  return {
    async stop() {
      if (!stopped) {
        stopped = true;
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        mute.disconnect();
        await ctx.close();
      }
      return { samples: mergeInt16(chunks), durationSec: total / WHISPER_RATE };
    },
  };
}

/** Asks for the microphone (the browser shows its permission prompt) and starts capturing it. */
export async function captureMicrophone(
  options: Parameters<typeof startCapture>[1] = {}
): Promise<Capture & { release(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // No echo cancellation: on a speakerphone call it can erase the other person, who comes out of the speaker.
    audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const release = () => stream.getTracks().forEach((t) => t.stop()); // turns the browser's red "recording" dot off
  try {
    const capture = await startCapture(stream, options);
    return {
      async stop() {
        release();
        return capture.stop();
      },
      release,
    };
  } catch (e) {
    release();
    throw e;
  }
}
