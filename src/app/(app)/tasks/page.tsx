"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Priority, Task } from "@/lib/types";

const SOURCES = ["manual", "email", "meeting", "whatsapp", "browser", "call"];

type Form = {
  title: string;
  description: string;
  priority: Priority;
  due_date: string; // value of <input type="datetime-local">
  source_type: string;
  source_text: string;
  related_person: string;
};

const emptyForm: Form = {
  title: "",
  description: "",
  priority: "medium",
  due_date: "",
  source_type: "manual",
  source_text: "",
  related_person: "",
};

// Convert an ISO date from the database into the format <input type="datetime-local"> needs.
function toInputValue(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("tasks")
      .select("*")
      .order("status", { ascending: false }) // "todo" before "done"
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setTasks(data as Task[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function setField<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return setError("Title is required.");
    setError("");

    const row = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      source_type: form.source_type,
      source_text: form.source_text.trim() || null,
      related_person: form.related_person.trim() || null,
    };

    const supabase = createClient();
    const { error } = editingId
      ? await supabase.from("tasks").update(row).eq("id", editingId)
      : await supabase.from("tasks").insert(row); // user_id is filled in by the database
    if (error) return setError(error.message);

    closeForm();
    load();
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
    setShowForm(true);
    setForm({
      title: t.title,
      description: t.description ?? "",
      priority: t.priority,
      due_date: toInputValue(t.due_date),
      source_type: t.source_type ?? "manual",
      source_text: t.source_text ?? "",
      related_person: t.related_person ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggleDone(t: Task) {
    const done = t.status !== "done";
    const { error } = await createClient()
      .from("tasks")
      .update({
        status: done ? "done" : "todo",
        completed_at: done ? new Date().toISOString() : null,
      })
      .eq("id", t.id);
    if (error) setError(error.message);
    else load();
  }

  async function remove(t: Task) {
    if (!confirm(`Delete "${t.title}"?`)) return;
    const { error } = await createClient().from("tasks").delete().eq("id", t.id);
    if (error) setError(error.message);
    else load();
  }

  const q = search.trim().toLowerCase();
  const visible = tasks.filter(
    (t) =>
      !q ||
      [t.title, t.description, t.related_person, t.source_text, t.source_type]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Tasks</h1>
          <p className="page-subtitle">Create, track and complete your work.</p>
        </div>
        {!showForm && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={16} />
            New task
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={save} className="card card-body mb-6 grid gap-4">
          <div className="flex items-center justify-between">
            <h2>{editingId ? "Edit task" : "New task"}</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={closeForm} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          <div>
            <label className="label" htmlFor="title">Title</label>
            <input
              id="title"
              className="input"
              placeholder="e.g. Send RCA to client"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="desc">Description</label>
            <textarea
              id="desc"
              className="input"
              rows={2}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="priority">Priority</label>
              <select
                id="priority"
                className="input"
                value={form.priority}
                onChange={(e) => setField("priority", e.target.value as Priority)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="due">Due date</label>
              <input
                id="due"
                type="datetime-local"
                className="input"
                value={form.due_date}
                onChange={(e) => setField("due_date", e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="source">Source</label>
              <select
                id="source"
                className="input"
                value={form.source_type}
                onChange={(e) => setField("source_type", e.target.value)}
              >
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="person">Related person</label>
              <input
                id="person"
                className="input"
                placeholder="e.g. Rajesh"
                value={form.related_person}
                onChange={(e) => setField("related_person", e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="why">Why does this task exist?</label>
            <textarea
              id="why"
              className="input"
              rows={2}
              placeholder="Paste the original message or note (optional)"
              value={form.source_text}
              onChange={(e) => setField("source_text", e.target.value)}
            />
          </div>

          {error && <p className="alert-error">{error}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={closeForm}>
              Cancel
            </button>
            <button className="btn-primary">{editingId ? "Save changes" : "Add task"}</button>
          </div>
        </form>
      )}

      {!showForm && error && <p className="alert-error mb-4">{error}</p>}

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
        <input
          className="input pl-9"
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="card">
        {loading ? (
          <p className="card-body text-ink-muted">Loading...</p>
        ) : visible.length === 0 ? (
          <p className="card-body text-ink-muted">
            {tasks.length === 0 ? "No tasks yet. Click “New task” to add your first one." : "No tasks match your search."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((t) => {
              const done = t.status === "done";
              const overdue = !done && t.due_date && new Date(t.due_date) < new Date();
              return (
                <li key={t.id} className="flex gap-3 px-5 py-4">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                    checked={done}
                    onChange={() => toggleDone(t)}
                    aria-label="Mark complete"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${done ? "text-ink-subtle line-through" : ""}`}>{t.title}</p>
                    {t.description && <p className="mt-0.5 text-ink-muted">{t.description}</p>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`badge-${t.priority}`}>{t.priority}</span>
                      {t.source_type && <span className="badge-brand">{t.source_type}</span>}
                      {t.related_person && <span className="text-xs text-ink-muted">{t.related_person}</span>}
                      {t.due_date && (
                        <span className={`text-xs ${overdue ? "font-medium text-danger-600" : "text-ink-muted"}`}>
                          Due {new Date(t.due_date).toLocaleString()}
                          {overdue && " · overdue"}
                        </span>
                      )}
                    </div>
                    {t.source_text && (
                      <p className="mt-2 border-l-2 border-line pl-3 text-xs text-ink-muted">{t.source_text}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <button className="btn-ghost btn-sm" onClick={() => startEdit(t)} aria-label="Edit task">
                      <Pencil size={14} />
                    </button>
                    <button className="btn-danger btn-sm" onClick={() => remove(t)} aria-label="Delete task">
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
