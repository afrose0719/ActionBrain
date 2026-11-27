import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  captureComputerAndMic,
  captureMicrophone,
  computerAudioAvailable,
  computerAudioHelp,
  NoComputerAudioError,
  startCapture,
} from "../src/lib/recorder-core.ts";

// A fake browser audio system, so the recorder's own logic can be tested without a microphone.
class FakeNode {
  port: { onmessage: ((e: { data: Float32Array }) => void) | null } = { onmessage: null };
  gain = { value: 1 };
  links: unknown[] = [];
  disconnected = false;
  connect(to: unknown) {
    this.links.push(to);
  }
  disconnect() {
    this.disconnected = true;
  }
}

// each fake registers itself here when created, so tests can inspect what the recorder built
const made: { contexts: FakeContext[]; worklets: FakeNode[] } = { contexts: [], worklets: [] };
const ctx = () => made.contexts[made.contexts.length - 1];
const worklet = () => made.worklets[made.worklets.length - 1];
let loadedModules: string[];

class FakeContext {
  sampleRate = 48000;
  destination = { kind: "destination" };
  closed = 0;
  source = new FakeNode();
  gainNode = new FakeNode();
  audioWorklet = { addModule: async (url: string) => void loadedModules.push(url) };
  constructor() {
    made.contexts.push(this);
  }
  async resume() {}
  createMediaStreamSource() {
    return this.source;
  }
  createGain() {
    return this.gainNode;
  }
  async close() {
    this.closed++;
  }
}
class FakeWorkletNode extends FakeNode {
  constructor() {
    super();
    made.worklets.push(this);
  }
}

const g = globalThis as Record<string, unknown>;
beforeEach(() => {
  loadedModules = [];
  made.contexts.length = 0;
  made.worklets.length = 0;
  g.AudioContext = FakeContext;
  g.AudioWorkletNode = FakeWorkletNode;
});

const stream = {} as MediaStream;
const frame = (n = 4096, amp = 0.3) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 300 * i) / 48000));
/** Plays this many seconds of 48 kHz audio into the recorder, in 4096-sample frames like the real worklet. */
const play = (seconds: number) => {
  for (let i = 0; i < Math.ceil((seconds * 48000) / 4096); i++) worklet().port.onmessage?.({ data: frame() });
};

test("loads the worklet and wires source to the worklet to a MUTED output (so it never plays the audio back)", async () => {
  await startCapture(stream);
  assert.deepEqual(loadedModules, ["/recorder-worklet.js"]);
  assert.ok(ctx().source.links.includes(worklet()));
  assert.ok(worklet().links.includes(ctx().gainNode));
  assert.equal(ctx().gainNode.gain.value, 0, "output must be silent");
  assert.ok(ctx().gainNode.links.includes(ctx().destination));
});

test("what it hears comes out as 16 kHz audio of the right length", async () => {
  const cap = await startCapture(stream);
  play(2);
  const { samples, durationSec } = await cap.stop();
  const expected = (Math.ceil((2 * 48000) / 4096) * 4096) / 3; // 48 kHz in, 16 kHz out
  assert.ok(Math.abs(samples.length - expected) <= 3, `${samples.length} vs ${expected}`);
  assert.ok(Math.abs(durationSec - samples.length / 16000) < 1e-9);
  assert.ok(samples.some((v) => Math.abs(v) > 1000), "the audio should not be silent");
});

test("reports the loudness of each frame", async () => {
  const levels: number[] = [];
  await startCapture(stream, { onLevel: (db) => levels.push(db) });
  worklet().port.onmessage?.({ data: frame(4096, 0.3) });
  worklet().port.onmessage?.({ data: new Float32Array(4096) });
  assert.equal(levels.length, 2);
  assert.ok(levels[0] > -20 && levels[0] < -10);
  assert.equal(levels[1], -100);
});

test("stops keeping audio at the time limit, and says so exactly once", async () => {
  let limitCalls = 0;
  const cap = await startCapture(stream, { maxSeconds: 1, onLimit: () => limitCalls++ });
  play(5);
  const { samples } = await cap.stop();
  assert.equal(limitCalls, 1);
  assert.ok(samples.length >= 16000 && samples.length <= 16000 + 4096 / 3 + 3, `kept ${samples.length} samples`);
});

test("stopping twice is safe: one shutdown, the same audio both times, and no more listening", async () => {
  const cap = await startCapture(stream);
  play(1);
  const first = await cap.stop();
  const second = await cap.stop();
  assert.equal(ctx().closed, 1);
  assert.equal(second.samples.length, first.samples.length);
  assert.equal(worklet().port.onmessage, null);
  assert.ok(worklet().disconnected && ctx().source.disconnected && ctx().gainNode.disconnected);
});

// ---------------- the microphone itself ----------------

function fakeMicrophone() {
  const stopped: boolean[] = [];
  const tracks = [{ stop: () => stopped.push(true) }];
  let asked: unknown = null;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async (constraints: unknown) => {
          asked = constraints;
          return { getTracks: () => tracks } as unknown as MediaStream;
        },
      },
    },
  });
  return { stopped, asked: () => asked };
}

test("microphone: asks for audio only, with echo cancellation OFF so a speakerphone caller is not erased", async () => {
  const mic = fakeMicrophone();
  await captureMicrophone();
  const audio = (mic.asked() as { audio: Record<string, unknown> }).audio;
  assert.equal(audio.echoCancellation, false);
  assert.equal(audio.channelCount, 1);
});

test("microphone: the browser's recording indicator is switched off when recording stops", async () => {
  const mic = fakeMicrophone();
  const cap = await captureMicrophone();
  assert.equal(mic.stopped.length, 0);
  play(1);
  await cap.stop();
  assert.equal(mic.stopped.length, 1);
});

test("microphone: if starting fails, the microphone is released instead of being left on", async () => {
  const mic = fakeMicrophone();
  g.AudioContext = class extends FakeContext {
    audioWorklet = { addModule: async () => Promise.reject(new Error("worklet blocked")) };
  };
  await assert.rejects(captureMicrophone(), /worklet blocked/);
  assert.equal(mic.stopped.length, 1, "the mic track must be stopped");
});

// ---------------- a call on this computer (WhatsApp Desktop/Web, Teams): its sound + the microphone ----------------

type Track = { kind: string; stop(): void; enabled: boolean; addEventListener(type: string, fn: () => void): void; end(): void };
function track(kind: string, log: string[]): Track {
  let onEnd: (() => void) | null = null;
  return {
    kind,
    enabled: true,
    stop: () => log.push("stop " + kind),
    addEventListener: (type, fn) => {
      if (type === "ended") onEnd = fn;
    },
    end: () => onEnd?.(),
  };
}

function fakeComputer({ withSound = true, micFails = false } = {}) {
  const log: string[] = [];
  const screenTracks = [track("video", log), ...(withSound ? [track("audio", log)] : [])];
  const micTracks = [track("mic", log)];
  const asked: { display?: Record<string, unknown>; mic?: { audio: Record<string, unknown> } } = {};
  g.MediaStream = class {
    constructor(public tracks: Track[]) {}
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getDisplayMedia: async (c: Record<string, unknown>) => {
          asked.display = c;
          return {
            getTracks: () => screenTracks,
            getAudioTracks: () => screenTracks.filter((t) => t.kind === "audio"),
            getVideoTracks: () => screenTracks.filter((t) => t.kind === "video"),
          };
        },
        getUserMedia: async (c: { audio: Record<string, unknown> }) => {
          asked.mic = c;
          if (micFails) throw new Error("mic blocked");
          return { getTracks: () => micTracks };
        },
      },
    },
  });
  return { log, asked, screenTracks };
}

test("computer call: asks for the computer's sound (system audio) and mixes it with the microphone", async () => {
  const pc = fakeComputer();
  let sources = 0;
  g.AudioContext = class extends FakeContext {
    createMediaStreamSource() {
      sources++;
      return this.source;
    }
  };
  await captureComputerAndMic();
  assert.equal(pc.asked.display?.systemAudio, "include");
  assert.equal((pc.asked.display?.audio as Record<string, unknown>).echoCancellation, false, "the other side must not be filtered out");
  assert.equal(pc.asked.mic?.audio.echoCancellation, true, "the speakers leaking into the mic would only be an echo");
  assert.equal(sources, 2, "call sound and microphone both feed the recording");
  assert.deepEqual(pc.log, ["stop video"], "the picture is stopped at once; the sound keeps going");
});

test("computer call: no sound shared (box not ticked) -> a clear error, and the screen share is stopped", async () => {
  const pc = fakeComputer({ withSound: false });
  await assert.rejects(captureComputerAndMic(), NoComputerAudioError);
  assert.deepEqual(pc.log, ["stop video"]);
});

test("computer call: if the microphone is refused, the screen share is stopped too", async () => {
  const pc = fakeComputer({ micFails: true });
  await assert.rejects(captureComputerAndMic(), /mic blocked/);
  assert.ok(pc.log.includes("stop audio") && pc.log.includes("stop video"));
});

test("computer call: stopping releases everything; the browser's own Stop sharing ends the recording", async () => {
  const pc = fakeComputer();
  let ended = 0;
  const cap = await captureComputerAndMic({ onEnded: () => ended++ });
  pc.screenTracks[1].end();
  assert.equal(ended, 1);
  play(1);
  await cap.stop();
  assert.deepEqual([...new Set(pc.log)].sort(), ["stop audio", "stop mic", "stop video"]);
});

test("computer call is offered on desktop browsers only", () => {
  const md = { getDisplayMedia: () => {} };
  const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
  assert.equal(computerAudioAvailable({ mediaDevices: md, userAgent: win }), true);
  assert.equal(computerAudioAvailable({ mediaDevices: md, userAgent: "Mozilla/5.0 (Linux; Android 16) Chrome/140.0 Mobile Safari/537.36" }), false);
  assert.equal(computerAudioAvailable({ mediaDevices: {}, userAgent: win }), false);
  assert.equal(computerAudioAvailable(undefined), false);
});

test("the help text names the right fix for each browser", () => {
  assert.match(computerAudioHelp("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/140.0"), /Firefox cannot/);
  assert.match(computerAudioHelp("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605 Version/18 Safari/605.1"), /Safari cannot/);
  assert.match(computerAudioHelp("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"), /macOS 14.2/);
  assert.match(computerAudioHelp("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0"), /Share system audio/);
});
