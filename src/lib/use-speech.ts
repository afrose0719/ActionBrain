"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Browsers ship speech recognition as SpeechRecognition / webkitSpeechRecognition, but TypeScript's
// built-in types do not include it, so we describe the small part we use.
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function friendlyError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it using the icon in your browser's address bar, then try again.";
    case "no-speech":
      return "I did not hear anything. Try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs an internet connection.";
    case "aborted":
      return "";
    default:
      return "Voice input failed. Try again.";
  }
}

/**
 * Speech to text. Call start() and speak; when you stop talking, onFinal(text) is called with what was said.
 * While listening, `interim` holds the live partial text.
 */
export function useSpeech(onFinal: (text: string) => void) {
  const supported = useSyncExternalStore(
    () => () => {},
    () => getCtor() !== null,
    () => false
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");

  const recRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  });

  // stop the microphone if the component disappears mid-sentence
  useEffect(() => {
    return () => recRef.current?.abort();
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return;

    setError("");
    setInterim("");
    finalRef.current = "";

    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false; // stops by itself after you pause

    rec.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else partial += r[0].transcript;
      }
      setInterim(finalRef.current + partial);
    };
    rec.onerror = (e) => setError(friendlyError(e.error));
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim("");
      const text = finalRef.current.trim();
      if (text) onFinalRef.current(text);
    };

    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch {
      setError("Could not start the microphone. Try again.");
    }
  }, []);

  const stop = useCallback(() => recRef.current?.stop(), []);

  return { supported, listening, interim, error, start, stop };
}
