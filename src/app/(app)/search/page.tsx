"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckSquare, Handshake, Inbox, Search, Sparkles } from "lucide-react";
import { authFetch } from "@/lib/api";

type Source = {
  id: string;
  type: "task" | "commitment" | "inbox";
  title: string;
  status: string | null;
  direction: "mine" | "theirs" | null;
  due_date: string | null;
};

const EXAMPLES = [
  "What do I need to do regarding WATI?",
  "What did I promise clients this week?",
  "Which tasks came from meetings?",
  "What am I waiting for?",
  "Show overdue commitments",
  "What should I focus on today?",
];

const TYPE_INFO = {
  task: { label: "Task", icon: CheckSquare, href: () => "/tasks" },
  commitment: { label: "Commitment", icon: Handshake, href: (s: Source) => (s.direction === "theirs" ? "/waiting" : "/commitments") },
  inbox: { label: "Inbox", icon: Inbox, href: () => "/inbox" },
} as const;

export default function SearchPage() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);

  async function run(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError("");
    setNeedsKey(false);
    setAnswer("");
    setSources([]);
    setAsked(q.trim());

    const res = await authFetch("/api/search", {
      method: "POST",
      body: JSON.stringify({
        question: q,
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
    setAnswer(body.answer);
    setSources(body.sources ?? []);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Search</h1>
          <p className="page-subtitle">Ask a question about your work. Answers come only from your own tasks, commitments and messages.</p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(question);
        }}
        className="card card-body"
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              className="input pl-9"
              placeholder="e.g. What do I need to do regarding WATI?"
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
              autoFocus
            />
          </div>
          <button className="btn-primary" disabled={busy || !question.trim()}>
            <Sparkles size={16} />
            {busy ? "Searching..." : "Ask"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="rounded-full border border-line bg-canvas px-3 py-1 text-xs text-ink-muted hover:border-brand-500 hover:text-brand-700"
              onClick={() => {
                setQuestion(ex);
                run(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <p className="alert-error mt-6">
          {error}{" "}
          {needsKey && (
            <Link href="/settings" className="font-medium underline">
              Open Settings
            </Link>
          )}
        </p>
      )}

      {answer && (
        <section className="card mt-6">
          <div className="border-b border-line px-5 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{asked}</p>
          </div>
          <p className="card-body whitespace-pre-wrap leading-6">{answer}</p>

          {sources.length > 0 && (
            <div className="border-t border-line px-5 py-4">
              <h2 className="mb-3 text-sm">Sources</h2>
              <ul className="grid gap-2">
                {sources.map((s) => {
                  const info = TYPE_INFO[s.type];
                  const Icon = info.icon;
                  return (
                    <li key={s.id}>
                      <Link
                        href={info.href(s)}
                        className="flex items-center gap-3 rounded-md border border-line px-3 py-2 hover:bg-canvas"
                      >
                        <Icon size={14} className="shrink-0 text-ink-muted" />
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="badge-brand shrink-0">{info.label}</span>
                        {s.status && <span className="badge-low shrink-0">{s.status}</span>}
                        {s.due_date && (
                          <span className="hidden shrink-0 text-xs text-ink-muted sm:inline">
                            Due {new Date(s.due_date).toLocaleDateString()}
                          </span>
                        )}
                        <ArrowUpRight size={14} className="shrink-0 text-ink-subtle" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}
