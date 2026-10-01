import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { captureMicrophone, startCapture } from "../src/lib/recorder-core.ts";

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
