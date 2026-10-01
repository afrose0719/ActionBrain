import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AudioFileError, decodeAudioFile, describeDecodeFailure, downmixToMono } from "../src/lib/decode-audio.ts";
import { SHARED_CACHE, isSharedId, takeSharedFile } from "../src/lib/shared-files.ts";

// ---------------- reading an audio file ----------------

test("stereo is averaged to mono, and a single channel is untouched", () => {
  const left = Float32Array.from([1, 0, -1, 0.5]);
  const right = Float32Array.from([0, 1, -1, -0.5]);
  assert.deepEqual([...downmixToMono([left, right])], [0.5, 0.5, -1, 0]);
  assert.equal(downmixToMono([left]), left);
  assert.equal(downmixToMono([]).length, 0);
});

test("a failure message names the format and says what to do", () => {
  assert.match(describeDecodeFailure("call.amr"), /AMR[\s\S]*M4A or MP3/);
  assert.match(describeDecodeFailure("call.3gpp"), /AMR/);
  assert.match(describeDecodeFailure("call.OPUS"), /\.opus/);
  assert.match(describeDecodeFailure("noextension"), /M4A, MP3, WAV/);
});

let created: { rate?: number; closed: number; decodeCalls: number };
let decoder: (data: ArrayBuffer) => Promise<unknown>;
const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  created = { closed: 0, decodeCalls: 0 };
  decoder = async () => ({ duration: 2, numberOfChannels: 2, getChannelData: (i: number) => Float32Array.from({ length: 32000 }, () => (i === 0 ? 0.5 : 0.1)) });
  g.AudioContext = class {
    constructor(options?: { sampleRate?: number }) {
      created.rate = options?.sampleRate;
    }
    decodeAudioData(data: ArrayBuffer) {
      created.decodeCalls++;
      return decoder(data);
    }
    async close() {
      created.closed++;
    }
  };
});

const file = (name = "call.m4a", bytes = 100) => new File([new Uint8Array(bytes)], name);

test("decoding asks the browser for 16 kHz, mixes to mono, and always closes the audio context", async () => {
  const { samples, durationSec } = await decodeAudioFile(file());
  assert.equal(created.rate, 16000);
  assert.equal(durationSec, 2);
  assert.equal(samples.length, 32000);
  assert.ok(Math.abs(samples[0] - Math.round(0.3 * 32767)) <= 1, "channels 0.5 and 0.1 should average to 0.3");
  assert.equal(created.closed, 1);
});

test("an unreadable file gives a friendly message, and still closes the audio context", async () => {
  decoder = async () => Promise.reject(new DOMException("bad data", "EncodingError"));
  await assert.rejects(decodeAudioFile(file("call.amr")), (e: Error) => e instanceof AudioFileError && /AMR/.test(e.message));
  assert.equal(created.closed, 1);
});

test("empty, huge and too-long files are refused with clear reasons", async () => {
  await assert.rejects(decodeAudioFile(file("a.m4a", 0)), /empty/);
  const huge = { size: 400 * 1024 * 1024, name: "big.m4a", arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
  await assert.rejects(decodeAudioFile(huge), /300 MB/);
  assert.equal(created.decodeCalls, 0, "refused before reading");
  decoder = async () => ({ duration: 100 * 60, numberOfChannels: 1, getChannelData: () => new Float32Array(1) });
  await assert.rejects(decodeAudioFile(file(), 90), /100 minutes long.*limit is 90/);
  assert.equal(created.closed, 1);
});

// ---------------- a file shared from the phone's share sheet ----------------

function fakeStorage(entries: Record<string, { body: string; type: string; name: string }> = {}) {
  const deleted: string[] = [];
  return {
    deleted,
    open: async (name: string) => {
      assert.equal(name, SHARED_CACHE);
      return {
        match: async (key: string) => {
          const e = entries[key];
          return e ? new Response(e.body, { headers: { "content-type": e.type, "x-file-name": encodeURIComponent(e.name) } }) : undefined;
        },
        delete: async (key: string) => void deleted.push(key),
      };
    },
  };
}

test("only well-formed ids are accepted, so a crafted address cannot read other cache entries", () => {
  assert.equal(isSharedId("1790000000123-ab12cd"), true);
  for (const bad of ["", "../x", "1790000000123-ab12cd/../../x", "abc", "1790000000123", "1790000000123-AB", null, undefined, 42]) {
    assert.equal(isSharedId(bad), false, String(bad));
  }
});

test("a shared recording is returned with its name and type, then deleted", async () => {
  const storage = fakeStorage({ "/__shared/1790000000123-ab12cd": { body: "AUDIO", type: "audio/mp4", name: "Call with Rajesh 10-30.m4a" } });
  const f = await takeSharedFile("1790000000123-ab12cd", storage as unknown as CacheStorage);
  assert.equal(f!.name, "Call with Rajesh 10-30.m4a");
  assert.equal(f!.type, "audio/mp4");
  assert.equal(await f!.text(), "AUDIO");
  assert.deepEqual(storage.deleted, ["/__shared/1790000000123-ab12cd"]);
});

test("a missing, expired or malformed id gives null and touches nothing", async () => {
  const storage = fakeStorage();
  assert.equal(await takeSharedFile("1790000000123-zzzzzz", storage as unknown as CacheStorage), null);
  assert.equal(await takeSharedFile("../../etc", storage as unknown as CacheStorage), null);
  assert.deepEqual(storage.deleted, []);
});

test("the cache name used by the page matches the one in the service worker", () => {
  const sw = readFileSync("public/sw.js", "utf8");
  assert.match(sw, new RegExp(`SHARED_CACHE = "${SHARED_CACHE}"`));
});
