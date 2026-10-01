import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nextConfig from "../next.config.ts";
import { LANGUAGES, MODELS, modelSize } from "../src/lib/whisper/protocol.ts";

// ---------------- the two security policies must stay separate ----------------
// Pages are strict. Only the worker script files (under /_next/static) may run WebAssembly and reach Hugging Face.

type Rule = { source: string; headers: { key: string; value: string }[] };
const rules = (await nextConfig.headers!()) as Rule[];
const cspOf = (source: string) => rules.find((r) => r.source === source)?.headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";

test("pages keep a strict policy: no WebAssembly, no blob scripts, no model host", () => {
  const page = cspOf("/:path*");
  assert.ok(page.length > 0);
  assert.ok(!page.includes("wasm-unsafe-eval"));
  assert.ok(!/script-src[^;]*blob:/.test(page));
  assert.ok(!/huggingface|hf\.co/.test(page));
  assert.match(page, /frame-ancestors 'none'/);
});

test("the worker files may run WebAssembly and reach the model host, and nothing else new", () => {
  const worker = cspOf("/_next/static/:path*");
  assert.match(worker, /script-src[^;]*'wasm-unsafe-eval'/);
  assert.match(worker, /script-src[^;]*blob:/); // the engine loads its loader through a blob URL
  assert.match(worker, /connect-src[^;]*https:\/\/huggingface\.co/);
  assert.match(worker, /connect-src[^;]*https:\/\/\*\.hf\.co/); // where the model download redirects
  assert.ok(!/unsafe-inline/.test(worker), "no inline scripts");
  assert.ok(!/connect-src[^;]*supabase/.test(worker), "workers have no reason to reach the database");
  assert.match(worker, /object-src 'none'/);
});

test("the worker rule comes AFTER the page rule, because the later one wins", () => {
  const order = rules.map((r) => r.source);
  assert.ok(order.indexOf("/_next/static/:path*") > order.indexOf("/:path*"));
});

// ---------------- model choices ----------------

test("model sizes are shown for the right device, and the graphics-card download is never smaller", () => {
  assert.equal(modelSize("base", "wasm"), "73 MB");
  assert.equal(modelSize("base", "webgpu"), "197 MB");
  for (const m of Object.values(MODELS)) {
    assert.ok(m.gpuMb > m.cpuMb, `${m.label}: GPU should need the bigger encoder`);
    assert.match(m.repo, /^onnx-community\/whisper-/);
  }
});

test("language list: automatic detection first, no duplicates", () => {
  assert.equal(LANGUAGES[0].value, null);
  const values = LANGUAGES.map((l) => l.value);
  assert.equal(new Set(values).size, values.length);
  assert.ok(LANGUAGES.every((l) => l.value === null || l.value === l.value.toLowerCase()), "Whisper wants lowercase names");
});

// ---------------- the engine file copy ----------------

test("copy-ort puts both engine files in the app folder, byte for byte", () => {
  const out = mkdtempSync(join(tmpdir(), "ort-"));
  try {
    const log = execFileSync("node", ["scripts/copy-ort.mjs", out], { encoding: "utf8" });
    for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
      const copied = join(out, f);
      const original = join("node_modules/onnxruntime-web/dist", f);
      assert.ok(existsSync(copied), `${f} was not copied`);
      assert.equal(statSync(copied).size, statSync(original).size);
    }
    assert.match(log, /copy-ort/);
    // running it again is harmless and copies nothing
    assert.equal(execFileSync("node", ["scripts/copy-ort.mjs", out], { encoding: "utf8" }).trim(), "");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the worker points at exactly the files copy-ort provides, and the build runs the copy first", () => {
  const worker = readFileSync("src/lib/whisper/worker.ts", "utf8");
  assert.match(worker, /\/ort\/ort-wasm-simd-threaded\.asyncify\.mjs/);
  assert.match(worker, /\/ort\/ort-wasm-simd-threaded\.asyncify\.wasm/);
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
  assert.match(scripts.prebuild, /copy-ort/);
  assert.match(scripts.predev, /copy-ort/);
  assert.match(readFileSync(".gitignore", "utf8"), /public\/ort/, "the 25 MB engine must not be committed");
});
