"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Plus, Sparkles, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { authFetch } from "@/lib/api";
import type { Commitment } from "@/lib/types";

const DAY = 24 * 60 * 60 * 1000;
const daysWaiting = (c: Commitment) => Math.floor((Date.now() - new Date(c.created_at).getTime()) / DAY);
const isOverdue = (c: Commitment) => !!c.due_date && new Date(c.due_date).getTime() < Date.now();

export default function WaitingForPage() {
  const [items, setItems] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // add form
  const [showForm, setShowForm] = useState(false);
  const [person, setPerson] = useState("");
  const [what, setWhat] = useState("");
  const [due, setDue] = useState("");

  // ask AI
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState("");
  const [askError, setAskError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("commitments")
      .select("*")
      .eq("direction", "theirs")
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    else setItems(data as Commitment[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!what.trim()) return setError("Describe what you are waiting for.");
    setError("");
    const { error } = await createClient()
      .from("commitments")
      .insert({
        direction: "theirs",
        owner_name: person.trim() || null,
        description: what.trim(),
        due_date: due ? new Date(due).toISOString() : null,
        status: "open",
        source_type: "manual",
      });
    if (error) return setError(error.message);
    setPerson("");
    setWhat("");
    setDue("");
    setShowForm(false);
    load();
  }

  async function received(c: Commitment) {
    const { error } = await createClient()
      .from("commitments")
      .update({ status: "done", completed_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) setError(error.message);
    else load();
  }

  async function remove(c: Commitment) {
    if (!confirm(`Delete "${c.description}"?`)) return;
    const { error } = await createClient().from("commitments").delete().eq("id", c.id);
    if (error) setError(error.message);
    else load();
  }

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    setAsking(true);
    setAskError("");
    setNeedsKey(false);
    setAnswer("");
    const res = await authFetch("/api/waiting/summary", {
      method: "POST",
      body: JSON.stringify({ question }),
    });
    const body = await res.json().catch(() => ({}));
    setAsking(false);
    if (!res.ok) {
      setNeedsKey(body.code === "NO_KEY");
      return setAskError(body.error ?? "Something went wrong.");
    }
    setAnswer(body.summary);
  }

  // group by person
  const groups = new Map<string, Commitment[]>();
  for (const c of items) {
    const key = c.owner_name?.trim() || "Unknown";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const overdueCount = items.filter(isOverdue).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Waiting For</h1>
          <p className="page-subtitle">
            {items.length === 0
              ? "Nothing outstanding."
              : `${items.length} thing${items.length > 1 ? "s" : ""} owed to you${overdueCount ? `, ${overdueCount} overdue` : ""}.`}
          </p>
        </div>
        {!showForm && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={16} />
            Add item
          </button>
        )}
      </div>

      <form onSubmit={ask} className="card card-body mb-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Sparkles size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-600" />
            <input
              className="input pl-9"
              placeholder="What am I waiting for?  (or ask: “Who should I chase today?”)"
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <button className="btn-primary" disabled={asking}>
            {asking ? "Thinking..." : "Ask"}
          </button>
        </div>
        {askError && (
          <p role="alert" className="alert-error mt-3">
            {askError}{" "}
            {needsKey && (
              <Link href="/settings" className="font-medium underline">
                Open Settings
              </Link>
            )}
          </p>
        )}
        {answer && <p className="mt-4 whitespace-pre-wrap rounded-md border border-line bg-canvas p-4">{answer}</p>}
      </form>

      {showForm && (
        <form onSubmit={add} className="card card-body mb-6 grid gap-4">
          <div className="flex items-center justify-between">
            <h2>Waiting for something</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowForm(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="who">Who owes it?</label>
              <input id="who" className="input" placeholder="e.g. Anish" value={person} onChange={(e) => setPerson(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="what">What are you waiting for?</label>
              <input id="what" className="input" placeholder="e.g. QA confirmation" value={what} onChange={(e) => setWhat(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="due">Expected by (optional)</label>
              <input id="due" type="datetime-local" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button className="btn-primary">Add</button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="alert-error mb-4">{error}</p>}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : items.length === 0 ? (
        <div className="card card-body text-ink-muted">
          You are not waiting on anyone. Items appear here when a message says someone will send you something, or when you add one.
        </div>
      ) : (
        <div className="grid gap-4">
          {[...groups.entries()].map(([name, list]) => (
            <section key={name} className="card">
              <div className="flex items-center gap-3 border-b border-line px-5 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                  {name.charAt(0).toUpperCase()}
                </span>
                <h2>{name}</h2>
                <span className="text-xs text-ink-muted">{list.length} item{list.length > 1 ? "s" : ""}</span>
              </div>
              <ul className="divide-y divide-line">
                {list.map((c) => {
                  const late = isOverdue(c);
                  const days = daysWaiting(c);
                  return (
                    <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-4">
                      <div className="min-w-0">
                        <p className="font-medium">{c.description}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                          {c.due_date && (
                            <span className={late ? "font-medium text-danger-600" : ""}>
                              Expected {new Date(c.due_date).toLocaleString()}
                              {late && " · overdue, time to chase"}
                            </span>
                          )}
                          <span>{days === 0 ? "Added today" : `Waiting ${days} day${days > 1 ? "s" : ""}`}</span>
                          {c.source_type && <span className="badge-brand">{c.source_type}</span>}
                        </div>
                        {c.source_text && <p className="mt-2 border-l-2 border-line pl-3 text-xs text-ink-muted">{c.source_text}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button className="btn-secondary btn-sm" onClick={() => received(c)}>
                          <Check size={14} />
                          Received
                        </button>
                        <button className="btn-danger btn-sm" onClick={() => remove(c)} aria-label="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
