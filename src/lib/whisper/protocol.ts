// The messages the page and the Whisper worker send each other.

export type ToWorker =
  | { id: number; type: "load"; model: string; device: Device }
  | { id: number; type: "transcribe"; audio: Float32Array; language: string | null };

export type FromWorker =
  | { id: number; type: "progress"; percent: number }
  | { id: number; type: "loaded" }
  | { id: number; type: "result"; text: string }
  | { id: number; type: "error"; message: string };

/** "webgpu" uses the graphics card (fast); "wasm" uses the CPU (works everywhere, slower). */
export type Device = "webgpu" | "wasm";

export type WhisperModel = "tiny" | "base" | "small";

// Speech models published by the community (Hugging Face "onnx-community"). Download sizes were measured from the hub:
// the graphics-card version needs a full-precision encoder, so it is a larger one-time download than the CPU version.
export const MODELS: Record<WhisperModel, { repo: string; label: string; cpuMb: number; gpuMb: number; note: string }> = {
  tiny: { repo: "onnx-community/whisper-tiny", label: "Tiny", cpuMb: 39, gpuMb: 114, note: "Fastest. Fine for clear English. A 30-minute call took about 10 minutes in testing." },
  base: { repo: "onnx-community/whisper-base", label: "Base", cpuMb: 73, gpuMb: 197, note: "Better with accents and other languages. About 20 minutes for a 30-minute call in testing." },
  small: { repo: "onnx-community/whisper-small", label: "Small", cpuMb: 238, gpuMb: 559, note: "Most accurate in theory, but large and untested for speed here. Not recommended on laptops." },
};

/** "114 MB" for the device in use. */
export const modelSize = (model: WhisperModel, device: Device) => `${MODELS[model][device === "webgpu" ? "gpuMb" : "cpuMb"]} MB`;

// The names Whisper expects. null means "detect the language by itself".
export const LANGUAGES: { label: string; value: string | null }[] = [
  { label: "Detect automatically", value: null },
  { label: "English", value: "english" },
  { label: "Hindi", value: "hindi" },
  { label: "Tamil", value: "tamil" },
  { label: "Telugu", value: "telugu" },
  { label: "Malayalam", value: "malayalam" },
  { label: "Kannada", value: "kannada" },
  { label: "Marathi", value: "marathi" },
  { label: "Bengali", value: "bengali" },
  { label: "Gujarati", value: "gujarati" },
  { label: "Urdu", value: "urdu" },
  { label: "Spanish", value: "spanish" },
  { label: "French", value: "french" },
  { label: "German", value: "german" },
  { label: "Arabic", value: "arabic" },
];
