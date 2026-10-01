import { MODELS, type Device, type FromWorker, type ToWorker, type WhisperModel } from "./protocol";

// Plain Omit<> on a union of message types keeps only the fields they share. This version removes `id` from each one.
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

type Pending = {
  resolve: (value: FromWorker) => void;
  reject: (reason: Error) => void;
  onProgress?: (percent: number) => void;
};

/** A friendly handle on the Whisper worker: ask it to load a model, then to turn audio into text. */
export class WhisperClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === "progress") return p.onProgress?.(msg.percent);
      this.pending.delete(msg.id);
      if (msg.type === "error") p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    this.worker.onerror = (event) => this.failAll(new Error(event.message || "The speech engine stopped unexpectedly."));
  }

  private failAll(error: Error) {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  private request(message: WithoutId<ToWorker>, onProgress?: (percent: number) => void, transfer: Transferable[] = []) {
    const id = this.nextId++;
    return new Promise<FromWorker>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ ...message, id }, transfer);
    });
  }

  /** Downloads (first time only) and prepares a model. `onProgress` reports 0-99 while downloading. */
  async load(model: WhisperModel, onProgress?: (percent: number) => void, device: Device = "wasm"): Promise<void> {
    await this.request({ type: "load", model: MODELS[model].repo, device }, onProgress);
  }

  /** Turns 16 kHz mono audio into text. The audio's memory is handed to the worker, so do not reuse the array afterwards. */
  async transcribe(audio: Float32Array, language: string | null): Promise<string> {
    const reply = await this.request({ type: "transcribe", audio, language }, undefined, [audio.buffer]);
    return reply.type === "result" ? reply.text : "";
  }

  /** Stops the worker and frees its memory. Anything still running is cancelled. */
  dispose() {
    this.worker.terminate();
    this.failAll(new Error("Cancelled."));
  }
}
