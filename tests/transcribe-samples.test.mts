import { test } from "node:test";
import assert from "node:assert/strict";
import { transcribeSamples, type Engine } from "../src/lib/transcribe-samples.ts";

const loud = (seconds: number) => Int16Array.from({ length: seconds * 16000 }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / 16000)));
const quiet = (seconds: number) => new Int16Array(seconds * 16000);

function fakeEngine(opts: { failLoadOn?: string; failTranscribe?: boolean; text?: (n: number) => string } = {}) {
  const log: string[] = [];
  let n = 0;
  const engine: Engine & { log: string[] } = {
    log,
    async load(_m, onProgress, device = "wasm") {
      log.push(`load:${device}`);
      onProgress?.(50);
      if (opts.failLoadOn === device) throw new Error(`${device} failed to start`);
    },
    async transcribe() {
      log.push("transcribe");
      if (opts.failTranscribe) throw new Error("model crashed");
      return opts.text ? opts.text(++n) : `part ${++n}`;
    },
    dispose() {
      log.push("dispose");
    },
  };
  return engine;
}

const base = { model: "base" as const, language: null, device: "wasm" as const };

test("a normal job loads once, transcribes, and always frees the engine", async () => {
  const engine = fakeEngine();
  const text = await transcribeSamples(loud(10), { ...base, createEngine: () => engine });
  assert.equal(text, "part 1");
  assert.deepEqual(engine.log, ["load:wasm", "transcribe", "dispose"]);
});

test("silent audio is never sent to Whisper (it would invent words), and an all-silent job returns nothing", async () => {
  const engine = fakeEngine();
  const text = await transcribeSamples(quiet(10), { ...base, createEngine: () => engine });
  assert.equal(text, "");
  assert.ok(!engine.log.includes("transcribe"));
});

test("a long recording is split into parts, in order, as one transcript", async () => {
  const engine = fakeEngine();
  const steps: string[] = [];
  const text = await transcribeSamples(loud(400), { ...base, createEngine: () => engine, onStep: (s) => steps.push(s) });
  assert.ok(steps.length >= 2, "400 seconds should need more than one part");
  assert.deepEqual(steps.map((s) => s.replace(/ of \d+/, "")), steps.map((_, i) => `Part ${i + 1}`));
  assert.equal(text.split("\n\n").length, steps.length);
  assert.ok(text.startsWith("part 1\n\npart 2"));
});

test("if the graphics card fails, it restarts on the processor with a FRESH engine", async () => {
  const engines: ReturnType<typeof fakeEngine>[] = [];
  const phases: string[] = [];
  const text = await transcribeSamples(loud(10), {
    ...base,
    device: "webgpu",
    createEngine: () => {
      const e = fakeEngine({ failLoadOn: engines.length === 0 ? "webgpu" : undefined });
      engines.push(e);
      return e;
    },
    onPhase: (p, d) => phases.push(`${p}:${d}`),
  });
  assert.equal(text, "part 1");
  assert.equal(engines.length, 2, "a second engine must be created, not the broken one reused");
  assert.deepEqual(engines[0].log, ["load:webgpu", "dispose"]);
  assert.deepEqual(engines[1].log, ["load:wasm", "transcribe", "dispose"]);
  assert.deepEqual(phases, ["downloading:webgpu", "downloading:wasm", "transcribing:wasm"]);
});

test("a processor failure is not retried: the error reaches the caller", async () => {
  let made = 0;
  await assert.rejects(
    transcribeSamples(loud(10), { ...base, createEngine: () => (made++, fakeEngine({ failTranscribe: true })) }),
    /model crashed/
  );
  assert.equal(made, 1);
});

test("cancelling stops the job without retrying on the processor", async () => {
  let made = 0;
  let cancelled = false;
  await assert.rejects(
    transcribeSamples(loud(400), {
      ...base,
      device: "webgpu",
      createEngine: () => (made++, fakeEngine()),
      onStep: () => {
        cancelled = true; // the user pressed Cancel during the first part
      },
      isCancelled: () => cancelled,
    }),
    /Cancelled/
  );
  assert.equal(made, 1, "must not fall back after a cancel");
});

test("progress runs from 0 and the engine handle is released when done", async () => {
  const percents: number[] = [];
  const handles: (Engine | null)[] = [];
  await transcribeSamples(loud(10), { ...base, createEngine: () => fakeEngine(), onPercent: (p) => percents.push(p), onEngine: (e) => handles.push(e) });
  assert.equal(percents[0], 0);
  assert.ok(handles[0] !== null && handles.at(-1) === null);
});
