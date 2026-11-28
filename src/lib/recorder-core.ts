import { createResampler, floatToInt16, mergeInt16, rmsDb, WHISPER_RATE } from "./audio.ts";

export type Capture = {
  /** Stops listening and returns everything heard, as 16 kHz mono 16-bit audio. */
  stop(): Promise<{ samples: Int16Array; durationSec: number }>;
};

/**
 * Listens to one or more audio streams (mixed together) and keeps them in memory, already converted to what Whisper needs.
 * Nothing is uploaded or saved: the audio exists only in this page until it has been turned into text.
 * Works with any MediaStream, so it can be tested without a real microphone.
 */
export async function startCapture(
  streams: MediaStream | MediaStream[],
  options: { onLevel?: (db: number) => void; maxSeconds?: number; onLimit?: () => void } = {}
): Promise<Capture> {
  const { onLevel, maxSeconds = 3600, onLimit } = options;

  const ctx = new AudioContext();
  await ctx.resume(); // browsers start audio "suspended" until the page has had a click
  await ctx.audioWorklet.addModule("/recorder-worklet.js");

  // Several sources connected to one input are summed by the browser: that is the mix of the call and the microphone.
  const sources = (Array.isArray(streams) ? streams : [streams]).map((s) => ctx.createMediaStreamSource(s));
  const node = new AudioWorkletNode(ctx, "pcm-capture");
  const mute = ctx.createGain();
  mute.gain.value = 0; // the graph must reach the speakers for the browser to run it, but we never want to play the audio back
  for (const source of sources) source.connect(node);
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
        for (const source of sources) source.disconnect();
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

/** The computer's sound could not be captured: the person did not tick "Share system audio", or the browser cannot share it. */
export class NoComputerAudioError extends Error {
  constructor() {
    super("no computer audio");
    this.name = "NoComputerAudioError";
  }
}

/**
 * A call on THIS computer (WhatsApp Desktop or Web, Teams): records what the computer plays (the other people) plus the microphone
 * (you), mixed. Nothing joins the call and nothing in WhatsApp or Teams is touched: the browser asks to share the screen with
 * "Share system audio", which is the operating system's own loopback. Only the sound is used; the picture is never read.
 * onEnded: the person pressed the browser's own "Stop sharing" button.
 */
export async function captureComputerAndMic(
  options: Parameters<typeof startCapture>[1] & { onEnded?: () => void } = {}
): Promise<Capture & { release(): void }> {
  const { onEnded, ...rest } = options;
  const screen = await navigator.mediaDevices.getDisplayMedia({
    video: true, // browsers only offer system audio together with a screen; the video is never used
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false },
    systemAudio: "include",
    selfBrowserSurface: "exclude",
    monitorTypeSurfaces: "include",
  } as DisplayMediaStreamOptions);
  const stopAll: MediaStream[] = [screen];
  const release = () => stopAll.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  try {
    const callAudio = screen.getAudioTracks();
    if (callAudio.length === 0) throw new NoComputerAudioError();
    screen.getVideoTracks().forEach((t) => t.stop()); // the picture is not needed: stop it so the computer does not encode it
    const mic = await navigator.mediaDevices.getUserMedia({
      // Echo cancellation ON here (unlike speakerphone mode): the other people already come in through the computer's sound,
      // so their voice leaking from the speakers into the microphone would only be an echo.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    stopAll.push(mic);
    callAudio[0].addEventListener("ended", () => onEnded?.());
    const capture = await startCapture([new MediaStream(callAudio), mic], rest);
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

/** Can this browser try to record a call on this computer? (Phones and tablets cannot share system audio.) */
export function computerAudioAvailable(nav: { mediaDevices?: { getDisplayMedia?: unknown }; userAgent?: string } | undefined): boolean {
  if (!nav?.mediaDevices?.getDisplayMedia) return false;
  return !/Android|iPhone|iPad|Mobile/i.test(nav.userAgent ?? "");
}

/** What to tell someone whose browser shared no sound. */
export function computerAudioHelp(userAgent: string): string {
  if (/Firefox\//.test(userAgent)) return "Firefox cannot share the computer's sound. Use Chrome or Edge for this.";
  if (/Safari\//.test(userAgent) && !/Chrome\/|Edg\//.test(userAgent))
    return "Safari cannot share the computer's sound. Use Chrome or Edge for this.";
  if (/Mac OS X/.test(userAgent))
    return 'No sound was shared. In Chrome on a Mac (macOS 14.2 or later), choose "Entire screen" and turn on "Also share system audio".';
  return 'No sound was shared. Choose "Entire screen" and tick "Share system audio" at the bottom of the box, then Share.';
}
