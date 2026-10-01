"use client";

import { Mic, Square } from "lucide-react";

export function MicButton({
  supported,
  listening,
  onStart,
  onStop,
}: {
  supported: boolean;
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  if (!supported) return null; // e.g. Firefox: hide instead of showing a button that cannot work

  return (
    <button
      type="button"
      onClick={listening ? onStop : onStart}
      className={listening ? "btn-secondary border-danger-600 text-danger-600" : "btn-secondary"}
      aria-label={listening ? "Stop listening" : "Speak"}
      title={
        listening
          ? "Listening... click to stop"
          : "Speak. Your browser's speech service processes the audio (in Chrome, this is Google's)."
      }
    >
      {listening ? <Square size={14} className="animate-pulse fill-current" /> : <Mic size={16} />}
    </button>
  );
}
