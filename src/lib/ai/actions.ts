import type { Priority } from "@/lib/types";

// The only things the AI is allowed to ask for. Anything else is rejected.
export type TaskChanges = {
  title?: string;
  description?: string | null;
  priority?: Priority;
  due_date?: string | null; // ISO 8601
  related_person?: string | null;
};

export type Action =
  | { action: "CREATE_TASK"; task: TaskChanges & { title: string } }
  | { action: "UPDATE_TASK"; task_id: string; changes: TaskChanges }
  | { action: "COMPLETE_TASK"; task_id: string }
  | { action: "DELETE_TASK"; task_id: string }
  | { action: "UNKNOWN"; message: string };

export type TaskRef = { id: string; title: string };

const PRIORITIES = ["low", "medium", "high"];

function cleanChanges(raw: unknown): TaskChanges | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: TaskChanges = {};

  if (r.title !== undefined) {
    if (typeof r.title !== "string" || !r.title.trim()) return null;
    out.title = r.title.trim().slice(0, 200);
  }
  if (r.description !== undefined) {
    if (r.description !== null && typeof r.description !== "string") return null;
    out.description = r.description ? (r.description as string).slice(0, 2000) : null;
  }
  if (r.priority !== undefined) {
    if (typeof r.priority !== "string" || !PRIORITIES.includes(r.priority)) return null;
    out.priority = r.priority as Priority;
  }
  if (r.due_date !== undefined) {
    if (r.due_date === null) out.due_date = null;
    else if (typeof r.due_date === "string" && !Number.isNaN(Date.parse(r.due_date)))
      out.due_date = new Date(r.due_date).toISOString();
    else return null;
  }
  if (r.related_person !== undefined) {
    if (r.related_person !== null && typeof r.related_person !== "string") return null;
    out.related_person = r.related_person ? (r.related_person as string).trim().slice(0, 120) : null;
  }
  return out;
}

/**
 * Checks the AI's raw JSON. Returns a clean Action, or an UNKNOWN action explaining the problem.
 * task_id must be one of the user's real tasks — the AI cannot invent ids.
 */
export function validateAction(raw: unknown, tasks: TaskRef[]): Action {
  const bad = (message: string): Action => ({ action: "UNKNOWN", message });
  if (!raw || typeof raw !== "object") return bad("The AI returned an unreadable answer.");
  const r = raw as Record<string, unknown>;

  switch (r.action) {
    case "CREATE_TASK": {
      const task = cleanChanges(r.task);
      if (!task || !task.title) return bad("I could not work out a title for the new task.");
      return { action: "CREATE_TASK", task: task as TaskChanges & { title: string } };
    }
    case "UPDATE_TASK": {
      const changes = cleanChanges(r.changes);
      if (!changes || Object.keys(changes).length === 0) return bad("I could not tell what to change.");
      if (typeof r.task_id !== "string" || !tasks.some((t) => t.id === r.task_id))
        return bad("I could not find which task you mean.");
      return { action: "UPDATE_TASK", task_id: r.task_id, changes };
    }
    case "COMPLETE_TASK":
    case "DELETE_TASK": {
      if (typeof r.task_id !== "string" || !tasks.some((t) => t.id === r.task_id))
        return bad("I could not find which task you mean.");
      return { action: r.action, task_id: r.task_id };
    }
    case "UNKNOWN":
      return bad(typeof r.message === "string" ? r.message : "I did not understand that.");
    default:
      return bad("I did not understand that command.");
  }
}
