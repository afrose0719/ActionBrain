"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, Check, Pencil, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { authFetch } from "@/lib/api";
import type { InboxItem, Priority, Suggestion } from "@/lib/types";

const SOURCES = ["email", "whatsapp", "meeting", "browser", "call", "note"];

function toInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // add form
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState("email");
  const [sourceRef, setSourceRef] = useState("");
  const [adding, setAdding] = useState(false);

  // inline edit of one suggestion
  const [editing, setEditing] = useState<{ itemId: string; draft: Suggestion } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("inbox_items")
      .select("*")
      .neq("status", "archived")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setItems(data as InboxItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function saveSuggestions(item: InboxItem, suggestions: Suggestion[]) {
    const { error } = await createClient()
      .from("inbox_items")
      .update({ ai_suggestions: suggestions, status: "analyzed" })
      .eq("id", item.id);
    if (error) setError(error.message);
    await load();
  }

  async function analyze(item: InboxItem) {
    setBusyId(item.id);
    setError("");
    setNeedsKey(false);
    const res = await authFetch("/api/inbox/analyze", {
      method: "POST",
      body: JSON.stringify({
        content: item.content,
        now: new Date().toString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNeedsKey(body.code === "NO_KEY");
      setError(body.error ?? "Analysis failed.");
    } else {
      const suggestions: Suggestion[] = body.suggestions.map((s: Omit<Suggestion, "id" | "state">) => ({
        ...s,
        id: crypto.randomUUID(),
        state: "pending",
      }));
      await saveSuggestions(item, suggestions);
    }
    setBusyId(null);
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setAdding(true);
    setError("");
    const { data, error } = await createClient()
      .from("inbox_items")
      .insert({ content: content.trim(), source_type: sourceType, source_ref: sourceRef.trim() || null })
      .select()
      .single();
    setAdding(false);
    if (error) return setError(error.message);
    setContent("");
    setSourceRef("");
    await load();
    analyze(data as InboxItem);
  }

  async function createTask(item: InboxItem, s: Suggestion) {
    setBusyId(s.id);
    const provenance = s.quote || item.content.slice(0, 300);
    const { error } = await createClient()
      .from("tasks")
      .insert({
        title: s.title,
        description: s.description ?? null,
        priority: s.priority,
        due_date: s.due_date,
        related_person: s.related_person ?? null,
        source_type: item.source_type,
        source_id: item.id,
        source_text: item.source_ref ? `${item.source_ref}: ${provenance}` : provenance,
        ai_generated: true,
        confidence: s.confidence,
      });
    if (error) {
      setBusyId(null);
      return setError(error.message);
    }
    await saveSuggestions(item, item.ai_suggestions.map((x) => (x.id === s.id ? { ...x, state: "created" } : x)));
    setBusyId(null);
  }

  async function dismiss(item: InboxItem, s: Suggestion) {
    await saveSuggestions(item, item.ai_suggestions.map((x) => (x.id === s.id ? { ...x, state: "dismissed" } : x)));
  }

  async function archive(item: InboxItem) {
    const { error } = await createClient().from("inbox_items").update({ status: "archived" }).eq("id", item.id);
    if (error) setError(error.message);
    else load();
  }

  async function applyEdit() {
    if (!editing) return;
    const item = items.find((i) => i.id === editing.itemId);
    if (!item || !editing.draft.title.trim()) return;
    await saveSuggestions(
      item,
      item.ai_suggestions.map((x) => (x.id === editing.draft.id ? { ...editing.draft, title: editing.draft.title.trim() } : x))
    );
    setEditing(null);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Inbox</h1>
          <p className="page-subtitle">
            Paste a message. AI finds the actions in it, and you decide what becomes a task.
          </p>
        </div>
      </div>

      <form onSubmit={addItem} className="card card-body mb-6 grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="src">Source</label>
            <select id="src" className="input" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="ref">Where from? (optional)</label>
            <input
              id="ref"
              className="input"
              placeholder="e.g. Email from Rajesh"
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="content">Message</label>
          <textarea
            id="content"
            className="input"
            rows={4}
            maxLength={6000}
            placeholder='e.g. "Can you send the RCA document to the client by Friday?"'
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <button className="btn-primary" disabled={adding || !content.trim()}>
            <Sparkles size={16} />
            {adding ? "Adding..." : "Add & analyze"}
          </button>
        </div>
      </form>

      {error && (
        <p className="alert-error mb-4">
          {error}{" "}
          {needsKey && (
            <Link href="/settings" className="font-medium underline">
              Open Settings
            </Link>
          )}
        </p>
      )}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : items.length === 0 ? (
        <div className="card card-body text-ink-muted">Your inbox is empty. Paste a message above to get started.</div>
      ) : (
        <ul className="grid gap-4">
          {items.map((item) => {
            const pending = item.ai_suggestions.filter((s) => s.state === "pending").length;
            return (
              <li key={item.id} className="card">
                <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="badge-brand">{item.source_type}</span>
                      {item.source_ref && <span className="text-xs text-ink-muted">{item.source_ref}</span>}
                      <span className="text-xs text-ink-subtle">{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{item.content}</p>
                  </div>
                  <button className="btn-ghost btn-sm shrink-0" onClick={() => archive(item)} aria-label="Archive">
                    <Archive size={14} />
                    Archive
                  </button>
                </div>

                <div className="px-5 py-4">
                  {item.status === "new" ? (
                    <button className="btn-secondary btn-sm" disabled={busyId === item.id} onClick={() => analyze(item)}>
                      <Sparkles size={14} />
                      {busyId === item.id ? "Analyzing..." : "Analyze with AI"}
                    </button>
                  ) : item.ai_suggestions.length === 0 ? (
                    <p className="text-ink-muted">No actions detected in this message.</p>
                  ) : (
                    <>
                      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
                        {pending > 0 ? `AI detected ${pending} possible task${pending > 1 ? "s" : ""}` : "All suggestions reviewed"}
                      </p>
                      <ul className="grid gap-3">
                        {item.ai_suggestions.map((s) => {
                          const isEditing = editing?.draft.id === s.id;
                          return (
                            <li key={s.id} className="rounded-md border border-line bg-canvas p-3">
                              {isEditing && editing ? (
                                <div className="grid gap-3">
                                  <input
                                    className="input"
                                    value={editing.draft.title}
                                    onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, title: e.target.value } })}
                                  />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <select
                                      className="input"
                                      value={editing.draft.priority}
                                      onChange={(e) =>
                                        setEditing({ ...editing, draft: { ...editing.draft, priority: e.target.value as Priority } })
                                      }
                                    >
                                      <option value="low">Low</option>
                                      <option value="medium">Medium</option>
                                      <option value="high">High</option>
                                    </select>
                                    <input
                                      type="datetime-local"
                                      className="input"
                                      value={toInputValue(editing.draft.due_date)}
                                      onChange={(e) =>
                                        setEditing({
                                          ...editing,
                                          draft: {
                                            ...editing.draft,
                                            due_date: e.target.value ? new Date(e.target.value).toISOString() : null,
                                          },
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <button className="btn-primary btn-sm" onClick={applyEdit}>
                                      Save
                                    </button>
                                    <button className="btn-secondary btn-sm" onClick={() => setEditing(null)}>
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
                                      {s.due_date && (
                                        <span className="text-ink-muted">Due {new Date(s.due_date).toLocaleString()}</span>
                                      )}
                                      {s.related_person && <span className="text-ink-muted">{s.related_person}</span>}
                                      <span className="text-ink-subtle">{Math.round(s.confidence * 100)}% confident</span>
                                    </div>
                                    {s.quote && <p className="mt-2 border-l-2 border-line pl-3 text-xs text-ink-muted">{s.quote}</p>}
                                  </div>
                                  {s.state === "pending" ? (
                                    <div className="flex shrink-0 gap-1">
                                      <button className="btn-primary btn-sm" disabled={busyId === s.id} onClick={() => createTask(item, s)}>
                                        <Check size={14} />
                                        Create task
                                      </button>
                                      <button
                                        className="btn-ghost btn-sm"
                                        onClick={() => setEditing({ itemId: item.id, draft: s })}
                                        aria-label="Edit suggestion"
                                      >
                                        <Pencil size={14} />
                                      </button>
                                      <button className="btn-ghost btn-sm" onClick={() => dismiss(item, s)} aria-label="Ignore suggestion">
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
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
