// Runs Whisper speech recognition inside a background worker, so the page stays responsive while it works.
// Everything happens on the user's own device. The audio never leaves it.
// Only the model files (not the audio) are downloaded, once, from Hugging Face, and the browser keeps them afterwards.

import { pipeline, env } from "@huggingface/transformers";
import type { FromWorker, ToWorker } from "./protocol";

env.allowLocalModels = false; // there are no model files on our server; fetch them from the hub
env.useBrowserCache = true; // keep downloaded models in the browser, so this happens only once
const wasm = env.backends.onnx.wasm;
if (wasm) {
  wasm.numThreads = 1; // extra threads need a special page setting (cross-origin isolation) that this app does not use
  // Serve the engine from this app (see scripts/copy-ort.mjs). The default is a public CDN, which the security policy blocks.
  wasm.wasmPaths = {
    mjs: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${self.location.origin}/ort/ort-wasm-simd-threaded.asyncify.wasm`,
  };
}

type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;
// The library's own types are enormous and slow the compiler to a crawl, so describe only the part we use.
const makePipeline = pipeline as unknown as (task: string, model: string, options: Record<string, unknown>) => Promise<Transcriber>;

const scope = self as unknown as { postMessage(message: FromWorker): void; onmessage: ((event: MessageEvent<ToWorker>) => void) | null };

let transcriber: Transcriber | null = null;
let loadedModel = "";
let loadedDevice = "";

type FileProgress = { status: string; file?: string; loaded?: number; total?: number };

scope.onmessage = async (event) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      if (!transcriber || loadedModel !== msg.model || loadedDevice !== msg.device) {
        const files = new Map<string, { loaded: number; total: number }>();
        let shown = 0;
        transcriber = await makePipeline("automatic-speech-recognition", msg.model, {
          ...(msg.device === "webgpu"
            ? // graphics card: full-precision encoder (the heavy part) with a compact 4-bit decoder
              { device: "webgpu", dtype: { encoder_model: "fp32", decoder_model_merged: "q4" } }
            : // CPU: the compact 8-bit version of the whole model
              { device: "wasm", dtype: "q8" }),
          progress_callback: (p: FileProgress) => {
            if (p.status !== "progress" || !p.file || !p.total) return;
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
            let loaded = 0;
            let total = 0;
            for (const f of files.values()) {
              loaded += f.loaded;
              total += f.total;
            }
            const percent = Math.min(99, Math.floor((loaded / total) * 100));
            if (percent > shown) {
              shown = percent; // only ever move forward, even as more files are discovered
              scope.postMessage({ id: msg.id, type: "progress", percent });
            }
          },
        });
        loadedModel = msg.model;
        loadedDevice = msg.device;
      }
      scope.postMessage({ id: msg.id, type: "loaded" });
    } else if (msg.type === "transcribe") {
      if (!transcriber) throw new Error("The speech model is not loaded yet.");
      const out = await transcriber(msg.audio, {
        chunk_length_s: 30, // Whisper reads 30 seconds at a time...
        stride_length_s: 5, // ...with overlap, so words at the joins are not lost
        task: "transcribe",
        return_timestamps: false,
        ...(msg.language ? { language: msg.language } : {}),
      });
      const text = (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text) ?? "";
      scope.postMessage({ id: msg.id, type: "result", text });
    }
  } catch (e) {
    scope.postMessage({ id: msg.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
