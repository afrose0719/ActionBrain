"use client";

import { useState } from "react";
import { Copy, Mail, Send } from "lucide-react";
import { authFetch } from "@/lib/api";
import { mailtoLink, notesForFollowUp, type FollowUp } from "@/lib/follow-up";
import type { Meeting } from "@/lib/types";

/** "Draft follow-up email": the AI writes it from this meeting's notes; the person edits it and sends it from their own email. */
export function FollowUpDraft({ meeting }: { meeting: Meeting }) {
  const [draft, setDraft] = useState<FollowUp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function write() {
    setBusy(true);
    setError("");
    const notes = notesForFollowUp({
      title: meeting.title,
      attendees: meeting.attendees,
      summary: meeting.summary,
      decisions: meeting.decisions,
      actions: meeting.ai_suggestions.filter((s) => s.state !== "dismissed"),
    });
    const res = await authFetch("/api/meetings/follow-up", { method: "POST", body: JSON.stringify({ notes }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Could not draft the email.");
    setDraft({ subject: body.subject, body: body.body });
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Select the text and copy it yourself.");
    }
  }

  if (!draft) {
    return (
      <div>
        <button className="btn-secondary btn-sm" onClick={write} disabled={busy}>
          <Mail size={14} />
          {busy ? "Writing..." : "Draft follow-up email"}
        </button>
        {error && (
          <p role="alert" className="mt-2 text-xs text-danger-600">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="animate-rise grid gap-2 rounded-md border border-line p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Follow-up email (draft: check it before sending)</p>
      <label className="label" htmlFor={`fu-subject-${meeting.id}`}>
        Subject
      </label>
      <input
        id={`fu-subject-${meeting.id}`}
        className="input"
        value={draft.subject}
        onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
      />
      <label className="label" htmlFor={`fu-body-${meeting.id}`}>
        Message
      </label>
      <textarea
        id={`fu-body-${meeting.id}`}
        className="input min-h-48"
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        <a className="btn-primary btn-sm" href={mailtoLink(draft)}>
          <Send size={14} />
          Open in my email app
        </a>
        <button className="btn-secondary btn-sm" onClick={copy}>
          <Copy size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn-ghost btn-sm" onClick={write} disabled={busy}>
          {busy ? "Writing..." : "Write again"}
        </button>
        <button className="btn-ghost btn-sm" onClick={() => setDraft(null)}>
          Close
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-600">
          {error}
        </p>
      )}
    </div>
  );
}
