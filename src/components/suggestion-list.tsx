"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import type { Priority, Suggestion } from "@/lib/types";
import { confidenceTier } from "@/lib/ai/actions";

const TIER = {
  high: { label: "Sure", className: "text-success-600" },
  review: { label: "Please check", className: "text-ink-muted" },
  clarify: { label: "Unclear: check before adding", className: "text-danger-600" },
} as const;

const LANGUAGE_NAMES: Record<string, string> = {
  ta: "Tamil", hi: "Hindi", ml: "Malayalam", te: "Telugu", kn: "Kannada", "ta-Latn": "Tanglish", "hi-Latn": "Hinglish", mixed: "Mixed languages",
};

/** The band shown to the user. Older saved suggestions have no tier, so it is worked out the same way. */
export function tierOf(s: Pick<Suggestion, "tier" | "confidence" | "quote" | "date_unclear">) {
  return s.tier ?? confidenceTier(s.confidence, { hasQuote: Boolean(s.quote), dateUnclear: Boolean(s.date_unclear) });
}

function toInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * The review list for AI-detected tasks: Create task / Edit / Ignore.
 * Used by both the Inbox and Meetings. The parent decides what "create", "dismiss" and "save edit" actually do.
 */
export function SuggestionList({
  suggestions,
  busyId,
  onCreate,
  onDismiss,
  onEdit,
}: {
  suggestions: Suggestion[];
  busyId: string | null;
  onCreate: (s: Suggestion) => void;
  onDismiss: (s: Suggestion) => void;
  onEdit: (s: Suggestion) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Suggestion | null>(null);

  async function saveDraft() {
    if (!draft || !draft.title.trim()) return;
    await onEdit({ ...draft, title: draft.title.trim() });
    setDraft(null);
  }

  return (
    <ul className="grid gap-3">
      {suggestions.map((s) => {
        const isEditing = draft?.id === s.id;
        return (
          <li key={s.id} className="rounded-md border border-line bg-canvas p-3">
            {isEditing && draft ? (
              <div className="grid gap-3">
                <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    className="input"
                    value={draft.priority}
                    onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <input
                    type="datetime-local"
                    className="input"
                    value={toInputValue(draft.due_date)}
                    onChange={(e) =>
                      setDraft({ ...draft, due_date: e.target.value ? new Date(e.target.value).toISOString() : null })
                    }
                  />
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary btn-sm" onClick={saveDraft}>
                    Save
                  </button>
                  <button className="btn-secondary btn-sm" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`font-medium ${s.state !== "pending" ? "text-ink-subtle" : ""}`}>{s.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`badge-${s.priority}`}>{s.priority}</span>
                    {s.due_date && <span className="text-ink-muted">Due {new Date(s.due_date).toLocaleString()}</span>}
                    {s.date_unclear && <span className="text-danger-600">Date unclear: please check</span>}
                    {s.related_person && <span className="text-ink-muted">{s.related_person}</span>}
                    <span className={TIER[tierOf(s)].className}>
                      {TIER[tierOf(s)].label} ({Math.round(s.confidence * 100)}%)
                    </span>
                    {s.language && LANGUAGE_NAMES[s.language] && <span className="text-ink-subtle">{LANGUAGE_NAMES[s.language]}</span>}
                  </div>
                  {s.quote && <p className="mt-2 border-l-2 border-line pl-3 text-xs text-ink-muted">{s.quote}</p>}
                </div>
                {s.state === "pending" ? (
                  <div className="flex shrink-0 gap-1">
                    <button className="btn-primary btn-sm" disabled={busyId === s.id} onClick={() => onCreate(s)}>
                      <Check size={14} />
                      Create task
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => setDraft(s)} aria-label="Edit suggestion">
                      <Pencil size={14} />
                    </button>
                    <button className="btn-ghost btn-sm" onClick={() => onDismiss(s)} aria-label="Ignore suggestion">
                      <X size={14} />
                      Ignore
                    </button>
                  </div>
                ) : (
                  <span className={s.state === "created" ? "badge-brand" : "badge-low"}>
                    {s.state === "created" ? "Task created" : "Ignored"}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
