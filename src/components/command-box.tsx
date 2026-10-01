"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { MicButton } from "@/components/mic-button";
import { useSpeech } from "@/lib/use-speech";
import type { Action, TaskChanges } from "@/lib/ai/actions";
import type { Task } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  priority: "Priority",
  due_date: "Due",
  related_person: "Person",
};

function describe(changes: TaskChanges) {
  return Object.entries(changes).map(([k, v]) => {
    const value = k === "due_date" && v ? new Date(v as string).toLocaleString() : (v ?? "none");
    return `${FIELD_LABELS[k] ?? k}: ${value}`;
  });
}

export function CommandBox({ tasks, onDone }: { tasks: Task[]; onDone: () => void }) {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [action, setAction] = useState<Action | null>(null);

  const taskTitle = (id: string) => tasks.find((t) => t.id === id)?.title ?? "(unknown task)";

  const speech = useSpeech((text) => {
    setCommand(text);
    submit(text); // the confirmation step below still applies
  });

  // Typed and spoken commands both end up here, so voice uses exactly the same engine and safety checks.
  async function submit(text: string) {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    setNeedsKey(false);
    setAction(null);

    const supabase = createClient();
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch("/api/command", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.session?.access_token}` },
      body: JSON.stringify({
        command: text,
        tasks: tasks.map(({ id, title, status, priority, due_date }) => ({ id, title, status, priority, due_date })),
        now: new Date().toString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNeedsKey(body.code === "NO_KEY");
      return setError(body.error ?? "Something went wrong.");
    }
    setAction(body.action);
  }

  // Runs ONLY after the user clicks Confirm. Row Level Security still applies.
  async function confirm() {
    if (!action || action.action === "UNKNOWN") return;
    setBusy(true);
    const tasksTable = createClient().from("tasks");
    let result;

    if (action.action === "CREATE_TASK") {
      result = await tasksTable.insert({ ...action.task, source_type: "ai-command", ai_generated: true });
    } else if (action.action === "UPDATE_TASK") {
      result = await tasksTable.update(action.changes).eq("id", action.task_id);
    } else if (action.action === "COMPLETE_TASK") {
      result = await tasksTable
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", action.task_id);
    } else {
      result = await tasksTable.delete().eq("id", action.task_id);
    }

    setBusy(false);
    if (result.error) return setError(result.error.message);
    setAction(null);
    setCommand("");
    onDone();
  }

  return (
    <div className="card card-body mb-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(command);
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Sparkles size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-600" />
          <input
            className="input pl-9"
            placeholder='Ask AI: "Remind me to send the RCA tomorrow at 10 AM" or "Move the RCA task to Friday"'
            value={speech.listening ? speech.interim || "Listening..." : command}
            readOnly={speech.listening}
            onChange={(e) => setCommand(e.target.value)}
            maxLength={500}
          />
        </div>
        <MicButton supported={speech.supported} listening={speech.listening} onStart={speech.start} onStop={speech.stop} />
        <button className="btn-primary" disabled={busy || !command.trim() || speech.listening}>
          {busy && !action ? "Thinking..." : "Run"}
        </button>
      </form>

      {!error && speech.error && <p className="alert-error mt-3">{speech.error}</p>}

      {error && (
        <p className="alert-error mt-3">
          {error}{" "}
          {needsKey && (
            <Link href="/settings" className="font-medium underline">
              Open Settings
            </Link>
          )}
        </p>
      )}

      {action && (
        <div className="mt-4 rounded-md border border-line bg-canvas p-4">
          {action.action === "UNKNOWN" ? (
            <>
              <p className="text-ink-muted">{action.message}</p>
              <button className="btn-secondary btn-sm mt-3" onClick={() => setAction(null)}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                {action.action === "CREATE_TASK" && "Create task"}
                {action.action === "UPDATE_TASK" && "Update task"}
                {action.action === "COMPLETE_TASK" && "Mark complete"}
                {action.action === "DELETE_TASK" && "Delete task"}
              </p>
              {action.action !== "CREATE_TASK" && <p className="mt-1 font-medium">{taskTitle(action.task_id)}</p>}
              {action.action === "CREATE_TASK" && <p className="mt-1 font-medium">{action.task.title}</p>}
              {(action.action === "CREATE_TASK" || action.action === "UPDATE_TASK") && (
                <ul className="mt-1 text-ink-muted">
                  {describe(action.action === "CREATE_TASK" ? { ...action.task, title: undefined } : action.changes)
                    .filter((line) => !line.endsWith("undefined"))
                    .map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  className={action.action === "DELETE_TASK" ? "btn-danger btn-sm border border-line" : "btn-primary btn-sm"}
                  onClick={confirm}
                  disabled={busy}
                >
                  <Check size={14} />
                  Confirm
                </button>
                <button className="btn-secondary btn-sm" onClick={() => setAction(null)} disabled={busy}>
                  <X size={14} />
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
