"use client";

import { useEffect, useRef, useState } from "react";
import { FileAudio, Lock, Mic, Monitor, Square, X } from "lucide-react";
import {
  captureComputerAndMic,
  captureMicrophone,
  computerAudioAvailable,
  computerAudioHelp,
  NoComputerAudioError,
} from "@/lib/recorder-core";
import { WhisperClient } from "@/lib/whisper/client";
import { LANGUAGES, MODELS, modelSize, type Device, type WhisperModel } from "@/lib/whisper/protocol";
import { formatDuration, isSilent } from "@/lib/audio";
import { AudioFileError, decodeAudioFile } from "@/lib/decode-audio";
import { transcribeSamples, type Engine } from "@/lib/transcribe-samples";

export type RecordingResult = { text: string; startedAt: Date; durationSec: number };

type Phase = "idle" | "starting" | "recording" | "downloading" | "transcribing";

const MAX_MINUTES = 60;
const PREFS_KEY = "actionbrain.recorder";

type Prefs = { model: WhisperModel; language: string | null; device: Device };

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null");
    if (saved && saved.model in MODELS) {
      return {
        model: saved.model,
        language: typeof saved.language === "string" ? saved.language : null,
        device: saved.device === "webgpu" ? "webgpu" : "wasm",
      };
    }
  } catch {
    /* storage can be unavailable (private mode): use the defaults */
  }
  return { model: "base", language: null, device: "wasm" };
}

type WakeLock = { release(): Promise<void> };

// Measured on a laptop with ordinary integrated graphics, the processor was about 3x FASTER than the graphics card, and its
// download was a third of the size. So the processor is the default; the graphics card is an opt-in for powerful GPUs.
const gpuAvailable = () => typeof navigator !== "undefined" && "gpu" in navigator;

export function CallRecorder({
  onTranscript,
  onClose,
  initialFile = null,
  recapOf = null,
}: {
  onTranscript: (result: RecordingResult) => void | Promise<void>;
  onClose: () => void;
  /** After-call recap (Milestone 32): the call it is about. Only the owner speaks, so no consent checkbox is needed. */
  recapOf?: { name: string; via: string; mins: number } | null;
  /** A call recording that arrived from the Android share sheet. It is transcribed once the person confirms they may use it. */
  initialFile?: File | null;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [consent, setConsent] = useState(Boolean(recapOf));
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(-100);
  const [percent, setPercent] = useState(0);
  const [step, setStep] = useState("");
  const [device, setDevice] = useState<Device>(prefs.device);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(initialFile);
  // "computer": a WhatsApp Desktop/Web or Teams call on this laptop (its sound + the microphone). "mic": the room, e.g. a phone on speaker.
  const [source, setSource] = useState<"mic" | "computer">("mic");
  const [canUseComputer, setCanUseComputer] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setCanUseComputer(computerAudioAvailable(navigator)));
    return () => cancelAnimationFrame(id);
  }, []);
  const fromComputer = source === "computer" && canUseComputer && !recapOf;

  const capture = useRef<Awaited<ReturnType<typeof captureMicrophone>> | null>(null);
  const client = useRef<Engine | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const startedAt = useRef(new Date());
  const wakeLock = useRef<WakeLock | null>(null);
  const cancelled = useRef(false);
  const finishRef = useRef<() => void>(() => {});

  const busy = phase !== "idle";

  function choose(next: Partial<Prefs>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(merged));
    } catch {
      /* not critical */
    }
  }

  // the timer on screen
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => setElapsed((Date.now() - startedAt.current.getTime()) / 1000), 500);
    return () => clearInterval(timer);
  }, [phase]);

  // closing the tab mid-call would lose the recording, so ask first
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // leaving the page: turn off the microphone and stop the speech engine
  useEffect(() => {
    return () => {
      capture.current?.release();
      client.current?.dispose();
      wakeLock.current?.release().catch(() => {});
    };
  }, []);

  async function keepScreenAwake() {
    // a phone that goes to sleep stops recording, so ask the browser to keep the screen on (not available everywhere)
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLock> } };
      wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      wakeLock.current = null;
    }
  }

  async function start() {
    setError("");
    cancelled.current = false;
    setPhase("starting");
    try {
      let lastShown = 0;
      const options = {
        maxSeconds: MAX_MINUTES * 60,
        onLevel: (db: number) => {
          const now = Date.now();
          if (now - lastShown > 100) {
            lastShown = now;
            setLevel(db);
          }
        },
        onLimit: () => finishRef.current(),
      };
      capture.current = fromComputer
        ? await captureComputerAndMic({ ...options, onEnded: () => finishRef.current() }) // "Stop sharing" in the browser = stop
        : await captureMicrophone(options);
      startedAt.current = new Date();
      setElapsed(0);
      setPhase("recording");
      keepScreenAwake();
    } catch (e) {
      setPhase("idle");
      const name = e instanceof DOMException ? e.name : "";
      if (e instanceof NoComputerAudioError) return setError(computerAudioHelp(navigator.userAgent));
      setError(
        name === "NotAllowedError"
          ? fromComputer
            ? "Sharing was cancelled, or the microphone is blocked. Press Start again and choose Share (allow the microphone if asked)."
            : "Microphone access is blocked. Allow it with the icon in your browser's address bar, then try again."
          : name === "NotFoundError"
            ? "No microphone was found."
            : "Could not start recording. Check that no other app is using the microphone."
      );
    }
  }

  // Turns audio into text with the shared engine (src/lib/transcribe-samples.ts), then hands the text to the page.
  async function transcribe(samples: Int16Array, durationSec: number, when: Date) {
    try {
      const text = await transcribeSamples(samples, {
        model: prefs.model,
        language: prefs.language,
        device: prefs.device === "webgpu" && gpuAvailable() ? "webgpu" : "wasm",
        createEngine: () => new WhisperClient(),
        onPhase: (p, d) => {
          setDevice(d);
          setPhase(p);
        },
        onPercent: setPercent,
        onStep: setStep,
        isCancelled: () => cancelled.current,
        onEngine: (e) => {
          client.current = e;
        },
      });
      if (!text) setError("No speech was recognised in that recording.");
      else await onTranscript({ text, startedAt: when, durationSec });
    } catch (e) {
      if (!cancelled.current) setError(e instanceof Error ? e.message : "Transcription failed.");
    } finally {
      setPhase("idle");
    }
  }

  // A call recording made by the phone's own recorder (chosen from the phone, or shared to ActionBrain).
  async function transcribeFile(recording: File) {
    setError("");
    cancelled.current = false;
    setPhase("starting");
    try {
      const { samples, durationSec } = await decodeAudioFile(recording);
      if (isSilent(samples)) {
        setPhase("idle");
        return setError("That recording is silent. Some phones only record your own side, or the recording failed. Try a different call.");
      }
      setFile(null);
      await transcribe(samples, durationSec, new Date(recording.lastModified || Date.now()));
    } catch (e) {
      setPhase("idle");
      setError(e instanceof AudioFileError ? e.message : "Could not read that recording.");
    }
  }

  async function finish() {
    const cap = capture.current;
    if (!cap) return;
    capture.current = null;
    wakeLock.current?.release().catch(() => {});
    setLevel(-100);

    const { samples, durationSec } = await cap.stop(); // this also turns the microphone off
    if (durationSec < 3) {
      setPhase("idle");
      return setError("That was too short to transcribe. Record at least a few seconds.");
    }
    if (isSilent(samples)) {
      setPhase("idle");
      return setError(
        fromComputer
          ? "No sound was picked up. Check that the call was playing on this computer and that \"Share system audio\" was ticked."
          : "No sound was picked up. Check your microphone, and put the call on speaker so it can be heard."
      );
    }
    await transcribe(samples, durationSec, startedAt.current);
  }
  // keeps the 60-minute auto-stop pointing at the latest version of finish()
  useEffect(() => {
    finishRef.current = finish;
  });

  function discard() {
    capture.current?.release();
    capture.current = null;
    wakeLock.current?.release().catch(() => {});
    setLevel(-100);
    setPhase("idle");
  }

  function cancelProcessing() {
    cancelled.current = true;
    client.current?.dispose();
  }

  const meter = Math.max(0, Math.min(100, ((level + 60) / 60) * 100)); // -60 dB (quiet) .. 0 dB (loudest) as a percentage

  return (
    <section className="card card-body mb-6 grid gap-4" aria-label="Record a call">
      <div className="flex items-center justify-between">
        <h2>{recapOf ? `Recap: ${recapOf.via} call with ${recapOf.name}` : "Record a call, or use a call recording"}</h2>
        <button type="button" className="btn-ghost btn-sm" onClick={onClose} disabled={busy} aria-label="Close recorder">
          <X size={16} />
        </button>
      </div>

      {phase === "idle" || phase === "starting" ? (
        <>
          {recapOf && (
            <div className="animate-rise grid gap-3 rounded-md border border-brand-100 bg-brand-50 px-4 py-3 text-brand-700">
              <p>
                <strong>Your {recapOf.mins}-minute call with {recapOf.name} just ended.</strong> Press Start and say in a few seconds what was
                agreed: who does what, by when. Only your own voice is recorded.
              </p>
              <button className="btn-primary w-fit" onClick={start} disabled={phase === "starting"}>
                <Mic size={16} />
                {phase === "starting" ? "Starting..." : "Start recap"}
              </button>
            </div>
          )}
          <p className="flex items-start gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-ink-muted">
            <Lock size={16} className="mt-0.5 shrink-0 text-success-600" />
            <span>
              Private: your voice is turned into text <strong>on this device</strong> and the audio is thrown away. Only the transcript is saved. The
              first time, a speech model downloads once and is remembered.
            </span>
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="rec-model">Speech model</label>
              <select id="rec-model" className="input" value={prefs.model} onChange={(e) => choose({ model: e.target.value as WhisperModel })}>
                {(Object.keys(MODELS) as WhisperModel[]).map((m) => (
                  <option key={m} value={m}>
                    {MODELS[m].label} ({modelSize(m, prefs.device)}): {MODELS[m].note}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="rec-lang">Language spoken</label>
              <select id="rec-lang" className="input" value={prefs.language ?? ""} onChange={(e) => choose({ language: e.target.value || null })}>
                {LANGUAGES.map((l) => (
                  <option key={l.label} value={l.value ?? ""}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {gpuAvailable() && (
            <div>
              <label className="label" htmlFor="rec-device">Processing</label>
              <select id="rec-device" className="input" value={prefs.device} onChange={(e) => choose({ device: e.target.value as Device })}>
                <option value="wasm">Processor (recommended)</option>
                <option value="webgpu">Graphics card (experimental, bigger download)</option>
              </select>
              <p className="mt-1.5 text-xs text-ink-muted">
                The graphics card can be faster on powerful or Apple graphics. On a laptop with basic integrated graphics it was about three times
                slower in testing. If it fails, the processor is used automatically.
              </p>
            </div>
          )}

          {canUseComputer && !recapOf && !file && (
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="label">Where is the call?</legend>
              {(
                [
                  ["computer", Monitor, "On this computer", "WhatsApp Desktop or Web, Teams, any call app. Records its sound and your microphone."],
                  ["mic", Mic, "Phone on speaker, or in the room", "Only the microphone listens."],
                ] as const
              ).map(([value, Icon, title, note]) => (
                <label
                  key={value}
                  className={`press flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 ${
                    source === value ? "border-brand-600 bg-brand-50" : "border-line"
                  }`}
                >
                  <input type="radio" name="rec-source" className="mt-1 accent-brand-600" checked={source === value} onChange={() => setSource(value)} />
                  <Icon size={16} className="mt-0.5 shrink-0 text-brand-600" />
                  <span>
                    <span className="block font-medium">{title}</span>
                    <span className="text-xs text-ink-muted">{note}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {fromComputer ? (
            <p className="text-xs text-ink-muted">
              Nothing joins the call and WhatsApp or Teams is not touched. After Start, your browser asks what to share: choose{" "}
              <strong>Entire screen</strong> and tick <strong>Share system audio</strong> (Chrome or Edge). Only the sound is used. Headphones give
              the clearest result. Stop with the button here or the browser&apos;s Stop sharing.
            </p>
          ) : null}

          <p className={`text-xs text-ink-muted ${recapOf || fromComputer ? "hidden" : ""}`}>
            The microphone only hears what is in the room. For a phone call, <strong>turn on speaker</strong> so both sides are picked up. Recording
            stops by itself after {MAX_MINUTES} minutes.
          </p>

          {file && (
            <p className="flex items-center gap-2 rounded-md border border-brand-100 bg-brand-50 px-3 py-2 text-brand-700">
              <FileAudio size={16} className="shrink-0" />
              <span className="min-w-0 truncate">
                Recording received: <strong>{file.name}</strong>
              </span>
            </p>
          )}

          <label className={`flex items-start gap-2 ${recapOf ? "hidden" : ""}`}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              {file
                ? "Everyone on this call knew it was being recorded and agreed."
                : fromComputer
                  ? "I told everyone on the call that ActionBrain is taking notes (\"I'm using ActionBrain to note action items, OK?\"), and they agreed."
                  : "Everyone in this conversation knows it is being recorded and agrees."}{" "}
              <span className="text-ink-muted">(Recording laws differ by country and state.)</span>
            </span>
          </label>

          <div className="flex flex-wrap gap-2">
            {file ? (
              <button className="btn-primary" onClick={() => transcribeFile(file)} disabled={!consent || phase === "starting"}>
                <FileAudio size={16} />
                {phase === "starting" ? "Reading..." : "Transcribe this recording"}
              </button>
            ) : (
              <button className="btn-primary" onClick={start} disabled={!consent || phase === "starting"}>
                <Mic size={16} />
                {phase === "starting" ? "Starting..." : "Start recording"}
              </button>
            )}
            <button className="btn-secondary" onClick={() => fileInput.current?.click()} disabled={!consent || phase === "starting"}>
              <FileAudio size={16} />
              {file ? "Choose a different recording" : "Use a call recording from my phone"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.m4a,.mp3,.aac,.wav,.ogg,.opus,.amr,.3gp,.3gpp,.mp4"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                e.target.value = ""; // so choosing the same file again works
                if (chosen) transcribeFile(chosen);
              }}
            />
          </div>
          <p className="text-xs text-ink-muted">
            Most Android phones can record calls themselves (open the Phone app, then its settings, and look for Call recording). Recordings made that way
            can be processed here, privately, with no upload.
          </p>
        </>
      ) : null}

      {phase === "recording" && (
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger-600 opacity-60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-danger-600" />
            </span>
            <strong>{fromComputer ? "Recording this computer's call and your microphone" : "Recording"}</strong>
            <span className="tabular-nums text-ink-muted">{formatDuration(elapsed)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
            <div className="h-full rounded-full bg-brand-600 transition-[width] duration-100" style={{ width: `${meter}%` }} />
          </div>
          <p className="text-xs text-ink-muted">Keep this tab open and the screen on. When you stop, ActionBrain transcribes it and suggests tasks and commitments for you to review.</p>
          <div className="flex gap-2">
            <button className="btn-primary" onClick={finish}>
              <Square size={14} />
              Stop &amp; transcribe
            </button>
            <button className="btn-secondary" onClick={discard}>
              Discard
            </button>
          </div>
        </div>
      )}

      {(phase === "downloading" || phase === "transcribing") && (
        <div className="grid gap-3" role="status">
          <p>
            <strong>{phase === "downloading" ? "Getting the speech model ready" : `Transcribing on this device (${device === "webgpu" ? "graphics card" : "processor"})`}</strong>
            {phase === "transcribing" && step ? `: ${step}` : ""}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
            <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-ink-muted">
            {phase === "downloading"
              ? `Downloading ${modelSize(prefs.model, device)} (${percent}%). This happens once; the browser remembers it.`
              : "This can take a while for a long call. Keep this tab open."}
          </p>
          <div>
            <button className="btn-secondary btn-sm" onClick={cancelProcessing}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
    </section>
  );
}
