"use client";

import { useCallback, useEffect, useState } from "react";
import { Undo2, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { summaryLine } from "@/lib/zero-touch";

type Added = { kind: "task" | "commitment"; id: string; title: string; source_text: string | null; auto_created_at: string };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;


/**
 * Everything ActionBrain added by itself in the last 7 days, with one-tap Undo (review round 5: mandatory safety net).
 * Undo deletes the task or promise only; the original message stays in the Inbox.
 */
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export function AutoAdded() {
  const [items, setItems] = useState<Added[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const since = new Date(Date.now() - WEEK_MS).toISOString();
    const [t, c] = await Promise.all([
      supabase.from("tasks").select("id, title, source_text, auto_created_at").gte("auto_created_at", since),
      supabase.from("commitments").select("id, description, source_text, auto_created_at").gte("auto_created_at", since),
    ]);
    if (t.error || c.error) return; // the database has not had Milestone 29 yet: show nothing
    const all: Added[] = [
      ...(t.data ?? []).map((r) => ({ kind: "task" as const, id: r.id, title: r.title, source_text: r.source_text, auto_created_at: r.auto_created_at })),
      ...(c.data ?? []).map((r) => ({ kind: "commitment" as const, id: r.id, title: r.description, source_text: r.source_text, auto_created_at: r.auto_created_at })),
    ].sort((a, b) => b.auto_created_at.localeCompare(a.auto_created_at));
    setItems(all);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function undo(item: Added) {
    setError("");
    const { error: e } = await createClient().from(item.kind === "task" ? "tasks" : "commitments").delete().eq("id", item.id);
    if (e) return setError(e.message);
    setItems((all) => all.filter((x) => x.id !== item.id));
  }

  if (items.length === 0) return null;
  const summary = summaryLine(items, new Date());

  return (
    <section className="card mb-6" aria-label="Added automatically">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <Zap size={16} className="text-brand-600" />
        <h2 className="text-sm">Added automatically (last 7 days)</h2>
      </div>
      <div className="card-body grid gap-2 text-sm">
        {summary && <p role="status" className="text-ink-muted">{summary}</p>}
        {items.map((i) => (
          <div
            key={i.kind + i.id}
            className={`animate-rise flex items-start justify-between gap-3 rounded-md ${isToday(i.auto_created_at) ? "animate-glow" : ""}`}
          >
            <div className="min-w-0">
              <p className="font-medium">
                {i.kind === "task" ? "Task: " : "Promise: "}
                {i.title}
              </p>
              {i.source_text && <p className="truncate text-xs text-ink-muted">{i.source_text}</p>}
            </div>
            <button className="btn-secondary btn-sm shrink-0" onClick={() => undo(i)} aria-label={`Undo: ${i.title}`}>
              <Undo2 size={14} />
              Undo
            </button>
          </div>
        ))}
        {error && <p role="alert" className="alert-error">{error}</p>}
      </div>
    </section>
  );
}
