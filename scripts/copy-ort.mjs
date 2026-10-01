#!/usr/bin/env node
// Copies the engine that runs Whisper (from onnxruntime-web) into public/ort, so the app serves it from
// its own address. By default the library downloads it from a public CDN, which the app's security policy (rightly)
// blocks, and which would also make transcription depend on a third party being online.
//
// It is 25.6 MB, so it is NOT stored in git: this runs automatically before `npm run dev` and `npm run build`.
// Usage: node scripts/copy-ort.mjs [output-folder]    (default: public/ort)

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// The "asyncify" build is the one this version of the library asks for. It runs on the graphics card (WebGPU) and also has the CPU kernels, so one build covers both.
export const FILES = ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"];

const root = process.cwd();
const source = ["node_modules/onnxruntime-web/dist", "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist"]
  .map((p) => resolve(root, p))
  .find((p) => FILES.every((f) => existsSync(join(p, f))));

if (!source) {
  console.error(`copy-ort: could not find ${FILES.join(" and ")} in node_modules/onnxruntime-web/dist. Run "npm install".`);
  process.exit(1); // fail the build loudly instead of shipping a recorder that cannot transcribe
}

const out = resolve(root, process.argv[2] ?? "public/ort");
mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const from = join(source, f);
  const to = join(out, f);
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue; // already there
  copyFileSync(from, to);
  console.log(`copy-ort: ${f} (${(statSync(from).size / 1048576).toFixed(1)} MB) -> ${out}`);
}
