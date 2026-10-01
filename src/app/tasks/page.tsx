"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

const priorityStyle: Record<Priority, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-700",
};

export default function TasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<Form>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/login");

    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .order("status", { ascending: false }) // "todo" before "done"
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setTasks(data as Task[]);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  function setField<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
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

    setForm(emptyForm);
    setEditingId(null);
    load();
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
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
    <main className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Tasks</h1>
        <a href="/dashboard" className="text-sm underline">
          Dashboard
        </a>
      </div>

      <form onSubmit={save} className="mb-8 grid gap-3 rounded-lg border p-4">
        <h2 className="font-semibold">{editingId ? "Edit task" : "New task"}</h2>
        <input
          className="rounded border p-2"
          placeholder="Title (e.g. Send RCA to client)"
          value={form.title}
          onChange={(e) => setField("title", e.target.value)}
        />
        <textarea
          className="rounded border p-2"
          placeholder="Description (optional)"
          rows={2}
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm">
            Priority
            <select
              className="rounded border p-2"
              value={form.priority}
              onChange={(e) => setField("priority", e.target.value as Priority)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Due date
            <input
              type="datetime-local"
              className="rounded border p-2"
              value={form.due_date}
              onChange={(e) => setField("due_date", e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Source
            <select
              className="rounded border p-2"
              value={form.source_type}
              onChange={(e) => setField("source_type", e.target.value)}
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Related person
            <input
              className="rounded border p-2"
              placeholder="e.g. Rajesh"
              value={form.related_person}
              onChange={(e) => setField("related_person", e.target.value)}
            />
          </label>
        </div>
        <textarea
          className="rounded border p-2"
          placeholder="Why does this task exist? Paste the original message (optional)"
          rows={2}
          value={form.source_text}
          onChange={(e) => setField("source_text", e.target.value)}
        />
        <div className="flex gap-2">
          <button className="rounded bg-black px-4 py-2 text-white">
            {editingId ? "Save changes" : "Add task"}
          </button>
          {editingId && (
            <button
              type="button"
              className="rounded border px-4 py-2"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <input
        className="mb-4 w-full rounded border p-2"
        placeholder="Search tasks..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p>Loading...</p>
      ) : visible.length === 0 ? (
        <p className="text-gray-500">
          {tasks.length === 0 ? "No tasks yet. Add your first one above." : "No tasks match your search."}
        </p>
      ) : (
        <ul className="grid gap-3">
          {visible.map((t) => {
            const done = t.status === "done";
            const overdue = !done && t.due_date && new Date(t.due_date) < new Date();
            return (
              <li key={t.id} className="flex gap-3 rounded-lg border p-3">
                <input
                  type="checkbox"
                  className="mt-1 h-5 w-5"
                  checked={done}
                  onChange={() => toggleDone(t)}
                  aria-label="Mark complete"
                />
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${done ? "text-gray-400 line-through" : ""}`}>{t.title}</p>
                  {t.description && <p className="text-sm text-gray-600">{t.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 ${priorityStyle[t.priority]}`}>{t.priority}</span>
                    {t.due_date && (
                      <span className={overdue ? "font-semibold text-red-600" : "text-gray-600"}>
                        Due {new Date(t.due_date).toLocaleString()}
                        {overdue && " (overdue)"}
                      </span>
                    )}
                    {t.related_person && <span className="text-gray-600">👤 {t.related_person}</span>}
                    {t.source_type && <span className="text-gray-500">Source: {t.source_type}</span>}
                  </div>
                  {t.source_text && (
                    <p className="mt-1 border-l-2 pl-2 text-xs italic text-gray-500">&ldquo;{t.source_text}&rdquo;</p>
                  )}
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <button className="underline" onClick={() => startEdit(t)}>
                    Edit
                  </button>
                  <button className="text-red-600 underline" onClick={() => remove(t)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
