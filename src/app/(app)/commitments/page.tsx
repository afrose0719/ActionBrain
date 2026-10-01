"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ListPlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Commitment, Direction } from "@/lib/types";

const DAY = 24 * 60 * 60 * 1000;

function toInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// overdue = past due. at risk = due within 24 hours.
function risk(c: Commitment): "overdue" | "soon" | null {
  if (c.status !== "open" || !c.due_date) return null;
  const left = new Date(c.due_date).getTime() - Date.now();
  return left < 0 ? "overdue" : left < DAY ? "soon" : null;
}

type Draft = { description: string; direction: Direction; person: string; due_date: string };
const emptyDraft: Draft = { description: "", direction: "mine", person: "", due_date: "" };

export default function CommitmentsPage() {
  const [items, setItems] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Direction>("mine");
  const [showDone, setShowDone] = useState(false);

  // one draft used for both "add" and "edit" (editingId = null means add)
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("commitments")
      .select("*")
      .neq("status", "dismissed")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setItems(data as Commitment[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function update(id: string, changes: Record<string, unknown>) {
    const { error } = await createClient().from("commitments").update(changes).eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  const confirmItem = (c: Commitment) => update(c.id, { status: "open" });
  const dismiss = (c: Commitment) => update(c.id, { status: "dismissed" });
  const toggleDone = (c: Commitment) =>
    update(c.id, c.status === "done" ? { status: "open", completed_at: null } : { status: "done", completed_at: new Date().toISOString() });

  async function remove(c: Commitment) {
    if (!confirm(`Delete "${c.description}"?`)) return;
    const { error } = await createClient().from("commitments").delete().eq("id", c.id);
    if (error) setError(error.message);
    else load();
  }

  async function makeTask(c: Commitment) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        title: c.description,
        due_date: c.due_date,
        related_person: c.direction === "mine" ? c.counterparty : c.owner_name,
        source_type: c.source_type,
        source_id: c.source_id,
        source_text: c.source_text,
        ai_generated: c.ai_generated,
        confidence: c.confidence,
      })
      .select("id")
      .single();
    if (error) return setError(error.message);
    await update(c.id, { task_id: data.id });
  }

  function openAdd() {
    setEditingId(null);
    setDraft({ ...emptyDraft, direction: tab });
    setShowForm(true);
  }

  function openEdit(c: Commitment) {
    setEditingId(c.id);
    setDraft({
      description: c.description,
      direction: c.direction,
      person: (c.direction === "mine" ? c.counterparty : c.owner_name) ?? "",
      due_date: toInputValue(c.due_date),
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setDraft(emptyDraft);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.description.trim()) return setError("Describe the commitment.");
    setError("");
    const person = draft.person.trim() || null;
    // For "mine" the other person is who it is owed to; for "theirs" they are the owner.
    const row = {
      description: draft.description.trim(),
      direction: draft.direction,
      owner_name: draft.direction === "theirs" ? person : null,
      counterparty: draft.direction === "mine" ? person : null,
      due_date: draft.due_date ? new Date(draft.due_date).toISOString() : null,
    };
    const supabase = createClient();
    const { error } = editingId
      ? await supabase.from("commitments").update(row).eq("id", editingId)
      : await supabase.from("commitments").insert({ ...row, status: "open", source_type: "manual" });
    if (error) return setError(error.message);
    closeForm();
    load();
  }

  const review = items.filter((c) => c.status === "suggested");
  const tracked = items.filter((c) => c.status !== "suggested" && c.direction === tab && (showDone || c.status === "open"));
  const atRisk = items.filter((c) => c.direction === "mine" && risk(c)).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Commitments</h1>
          <p className="page-subtitle">What you promised, and what others promised you.</p>
        </div>
        {!showForm && (
          <button className="btn-primary" onClick={openAdd}>
            <Plus size={16} />
            Add commitment
          </button>
        )}
      </div>

      {error && <p className="alert-error mb-4">{error}</p>}

      {showForm && (
        <form onSubmit={save} className="card card-body mb-6 grid gap-4">
          <div className="flex items-center justify-between">
            <h2>{editingId ? "Edit commitment" : "New commitment"}</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={closeForm} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div>
            <label className="label" htmlFor="desc">What was promised?</label>
            <input
              id="desc"
              className="input"
              placeholder="e.g. Send the RCA document"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="dir">Whose commitment?</label>
              <select
                id="dir"
                className="input"
                value={draft.direction}
                onChange={(e) => setDraft({ ...draft, direction: e.target.value as Direction })}
              >
                <option value="mine">Mine</option>
                <option value="theirs">Someone else&apos;s, to me</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="person">{draft.direction === "mine" ? "Owed to" : "Promised by"}</label>
              <input
                id="person"
                className="input"
                placeholder="e.g. Rajesh"
                value={draft.person}
                onChange={(e) => setDraft({ ...draft, person: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="due">Expected by</label>
              <input
                id="due"
                type="datetime-local"
                className="input"
                value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={closeForm}>
              Cancel
            </button>
            <button className="btn-primary">{editingId ? "Save changes" : "Add commitment"}</button>
          </div>
        </form>
      )}

      {review.length > 0 && (
        <section className="card mb-6 border-brand-100">
          <div className="border-b border-line bg-brand-50 px-5 py-3 text-brand-700">
            <h2>Needs your review ({review.length})</h2>
          </div>
          <ul className="divide-y divide-line">
            {review.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-medium">{c.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span className={c.direction === "mine" ? "badge-medium" : "badge-brand"}>
                      {c.direction === "mine" ? "Mine" : "Owed to me"}
                    </span>
                    <span>
                      {c.owner_name ?? "?"} → {c.counterparty ?? "?"}
                    </span>
                    {c.due_date && <span>Due {new Date(c.due_date).toLocaleString()}</span>}
                    {c.confidence != null && <span className="text-ink-subtle">{Math.round(c.confidence * 100)}% confident</span>}
                  </div>
                  {c.source_text && <p className="mt-2 border-l-2 border-line pl-3 text-xs text-ink-muted">{c.source_text}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button className="btn-primary btn-sm" onClick={() => confirmItem(c)}>
                    <Check size={14} />
                    Confirm
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => openEdit(c)} aria-label="Edit">
                    <Pencil size={14} />
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => dismiss(c)}>
                    <X size={14} />
                    Dismiss
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="inline-flex rounded-md border border-line bg-surface p-1">
          {(["mine", "theirs"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setTab(d)}
              className={`h-7 rounded px-3 text-xs font-medium ${
                tab === d ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:text-ink"
              }`}
            >
              {d === "mine" ? "My commitments" : "Owed to me"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" className="accent-brand-600" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show completed
        </label>
      </div>

      {tab === "mine" && atRisk > 0 && (
        <p className="mb-4 rounded-md border border-warning-600/20 bg-warning-50 px-3 py-2 text-warning-600">
          {atRisk} commitment{atRisk > 1 ? "s are" : " is"} overdue or due within 24 hours.
        </p>
      )}

      <div className="card">
        {loading ? (
          <p className="card-body text-ink-muted">Loading...</p>
        ) : tracked.length === 0 ? (
          <p className="card-body text-ink-muted">
            {tab === "mine"
              ? "No commitments yet. Analyze a message in the Inbox, or add one manually."
              : "Nothing owed to you yet."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tracked.map((c) => {
              const done = c.status === "done";
              const r = risk(c);
              return (
                <li key={c.id} className="flex gap-3 px-5 py-4">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                    checked={done}
                    onChange={() => toggleDone(c)}
                    aria-label="Mark fulfilled"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${done ? "text-ink-subtle line-through" : ""}`}>{c.description}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      {(c.counterparty || c.owner_name) && (
                        <span>{c.direction === "mine" ? `To ${c.counterparty ?? "?"}` : `From ${c.owner_name ?? "?"}`}</span>
                      )}
                      {c.due_date && (
                        <span className={r === "overdue" ? "font-medium text-danger-600" : r === "soon" ? "font-medium text-warning-600" : ""}>
                          Due {new Date(c.due_date).toLocaleString()}
                          {r === "overdue" && " · overdue"}
                          {r === "soon" && " · due soon"}
                        </span>
                      )}
                      {c.source_type && <span className="badge-brand">{c.source_type}</span>}
                      {c.task_id && <span className="badge-low">Task created</span>}
                    </div>
                    {c.source_text && <p className="mt-2 border-l-2 border-line pl-3 text-xs text-ink-muted">{c.source_text}</p>}
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {!c.task_id && !done && (
                      <button className="btn-ghost btn-sm" onClick={() => makeTask(c)} title="Create a task from this">
                        <ListPlus size={14} />
                      </button>
                    )}
                    <button className="btn-ghost btn-sm" onClick={() => openEdit(c)} aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => remove(c)} aria-label="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
