import { floatToInt16, WHISPER_RATE } from "./audio.ts";

/** A problem with an audio file that the person should be told about in plain words. */
export class AudioFileError extends Error {}

/** Mixes any number of channels (stereo calls are common) into one by averaging. Whisper needs mono. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i];
  for (let i = 0; i < out.length; i++) out[i] /= channels.length;
  return out;
}

/** What to tell someone when the browser cannot read their file. Phone call recorders use many formats. */
export function describeDecodeFailure(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["amr", "3gp", "3gpp", "awb"].includes(ext)) {
    return `This is an AMR (.${ext}) recording, an older phone-call format that browsers cannot play. In your phone's call-recording settings, switch the format to M4A or MP3 if it offers one, then record again.`;
  }
  if (["opus", "ogg", "oga"].includes(ext)) return `The browser could not read this .${ext} file. If you can, share it as M4A, MP3 or WAV instead.`;
  return `The browser could not read this file${ext ? ` (.${ext})` : ""}. M4A, MP3, WAV and AAC recordings usually work. If it is another format, switch your recorder to one of those.`;
}

export const MAX_RECORDING_MINUTES = 90;
const MAX_FILE_BYTES = 300 * 1024 * 1024;

/**
 * Reads an audio file and returns 16 kHz mono 16-bit audio, ready for Whisper. Everything stays on this device.
 * Asking for a 16 kHz audio context makes the browser convert the sample rate while decoding, so memory stays modest.
 */
export async function decodeAudioFile(file: File, maxMinutes = MAX_RECORDING_MINUTES): Promise<{ samples: Int16Array; durationSec: number }> {
  if (file.size === 0) throw new AudioFileError("That file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new AudioFileError("That file is larger than 300 MB. Try a shorter recording.");

  const ctx = new AudioContext({ sampleRate: WHISPER_RATE });
  try {
    let decoded: AudioBuffer;
    try {
      decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    } catch {
      throw new AudioFileError(describeDecodeFailure(file.name));
    }
    if (decoded.duration > maxMinutes * 60) {
      throw new AudioFileError(`That recording is ${Math.round(decoded.duration / 60)} minutes long. The limit is ${maxMinutes} minutes.`);
    }
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    return { samples: floatToInt16(downmixToMono(channels)), durationSec: decoded.duration };
  } finally {
    await ctx.close();
  }
}
