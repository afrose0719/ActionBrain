"use client";

import { useState } from "react";
import { Cloud, Lock } from "lucide-react";
import { ENGINES, loadSpeechPrefs, saveSpeechPrefs, type SpeechEngine, type SpeechPrefs } from "@/lib/cloud-speech";

/** Where speech becomes text: on this device (default) or the customer's own Sarvam/OpenAI account. Saved only in this browser. */
export function SpeechEnginePicker() {
  const [prefs, setPrefs] = useState<SpeechPrefs>(loadSpeechPrefs);
  const update = (next: SpeechPrefs) => {
    setPrefs(next);
    saveSpeechPrefs(next);
  };
  const engine = prefs.engine;
  const cloud = engine === "sarvam" || engine === "openai";
  const key = cloud ? (prefs.keys[engine] ?? "") : "";

  return (
    <div className="grid gap-2">
      <label className="label" htmlFor="rec-engine">
        Speech to text
      </label>
      <select id="rec-engine" className="input" value={engine} onChange={(e) => update({ ...prefs, engine: e.target.value as SpeechEngine })}>
        {(Object.keys(ENGINES) as SpeechEngine[]).map((id) => (
          <option key={id} value={id}>
            {ENGINES[id].label}
          </option>
        ))}
      </select>
      <p className="flex items-start gap-1.5 text-xs text-ink-muted">
        {cloud ? <Cloud size={14} className="mt-0.5 shrink-0" /> : <Lock size={14} className="mt-0.5 shrink-0 text-success-600" />}
        <span>
          {ENGINES[engine].note}
          {cloud && " The key is kept only in this browser. If it fails, ActionBrain uses the on-device engine instead."}
        </span>
      </p>
      {cloud && (
        <div>
          <label className="label" htmlFor="rec-engine-key">
            Your {engine === "sarvam" ? "Sarvam" : "OpenAI"} key
          </label>
          <input
            id="rec-engine-key"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            placeholder={ENGINES[engine].keyHelp}
            onChange={(e) => update({ ...prefs, keys: { ...prefs.keys, [engine]: e.target.value.trim() } })}
          />
          {!key && <p className="mt-1 text-xs text-ink-muted">Without a key, the on-device engine is used.</p>}
        </div>
      )}
    </div>
  );
}
