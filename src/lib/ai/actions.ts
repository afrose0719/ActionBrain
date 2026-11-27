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

/** Languages the extractor may report (ISO 639-1, plus romanised Tamil/Hindi for Tanglish/Hinglish). Anything else becomes "other". */
export const LANGUAGES = ["en", "ta", "hi", "ml", "te", "kn", "ta-Latn", "hi-Latn", "mixed", "other"] as const;
export type Language = (typeof LANGUAGES)[number];

export function cleanLanguage(v: unknown): Language | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const found = LANGUAGES.find((l) => l.toLowerCase() === v.trim().toLowerCase());
  return found ?? "other";
}

/**
 * How sure we are, as three bands that decide what the user is asked to do:
 *   high    (>= 0.85): ready to add;  review (0.60-0.84): check it;  clarify (< 0.60): ask before trusting it.
 * Never "high" without evidence (an exact quote) or with an unclear date: the user must see those.
 */
export type Tier = "high" | "review" | "clarify";
export function confidenceTier(confidence: number, opts: { hasQuote: boolean; dateUnclear: boolean }): Tier {
  const tier: Tier = confidence >= 0.85 ? "high" : confidence >= 0.6 ? "review" : "clarify";
  return tier === "high" && (!opts.hasQuote || opts.dateUnclear) ? "review" : tier;
}

export type RawSuggestion = {
  title: string;
  description: string | null;
  priority: Priority;
  due_date: string | null;
  related_person: string | null;
  confidence: number;
  quote: string;
  language: Language | null;
  date_unclear: boolean;
  tier: Tier;
};

/** Checks the AI's list of detected tasks for the Inbox. Bad entries are dropped, never trusted. */
export function validateSuggestions(raw: unknown): RawSuggestion[] {
  const list = raw && typeof raw === "object" ? (raw as Record<string, unknown>).suggestions : null;
  if (!Array.isArray(list)) return [];

  const out: RawSuggestion[] = [];
  for (const item of list.slice(0, 10)) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const changes = cleanChanges({
      title: r.title,
      description: r.description ?? undefined,
      priority: r.priority ?? undefined,
      due_date: r.due_date ?? undefined,
      related_person: r.related_person ?? undefined,
    });
    if (!changes?.title) continue;
    const confidence = typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.5;
    const quote = typeof r.quote === "string" ? r.quote.trim().slice(0, 300) : "";
    const date_unclear = r.date_unclear === true;
    out.push({
      title: changes.title,
      description: changes.description ?? null,
      priority: changes.priority ?? "medium",
      due_date: changes.due_date ?? null,
      related_person: changes.related_person ?? null,
      confidence,
      quote,
      language: cleanLanguage(r.language),
      date_unclear,
      tier: confidenceTier(confidence, { hasQuote: quote !== "", dateUnclear: date_unclear }),
    });
  }
  return out;
}

export type RawCommitment = {
  direction: "mine" | "theirs";
  owner_name: string | null;
  counterparty: string | null;
  description: string;
  due_date: string | null;
  confidence: number;
  quote: string;
  language: Language | null;
  date_unclear: boolean;
  tier: Tier;
};

const short = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Checks the AI's list of detected commitments. Bad entries are dropped. */
export function validateCommitments(raw: unknown): RawCommitment[] {
  const list = raw && typeof raw === "object" ? (raw as Record<string, unknown>).commitments : null;
  if (!Array.isArray(list)) return [];

  const out: RawCommitment[] = [];
  for (const item of list.slice(0, 10)) {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const description = short(r.description, 300);
    if (!description || (r.direction !== "mine" && r.direction !== "theirs")) continue;
    const due = typeof r.due_date === "string" && !Number.isNaN(Date.parse(r.due_date)) ? new Date(r.due_date).toISOString() : null;
    const confidence = typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.5;
    const quote = short(r.quote, 300) ?? "";
    const date_unclear = r.date_unclear === true;
    out.push({
      direction: r.direction,
      owner_name: short(r.owner, 120),
      counterparty: short(r.counterparty, 120),
      description,
      due_date: due,
      confidence,
      quote,
      language: cleanLanguage(r.language),
      date_unclear,
      tier: confidenceTier(confidence, { hasQuote: quote !== "", dateUnclear: date_unclear }),
    });
  }
  return out;
}

/** Checks the AI's meeting summary and decision list. */
export function validateMeetingExtras(raw: unknown): { summary: string; decisions: string[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const summary = typeof r.summary === "string" ? r.summary.trim().slice(0, 1500) : "";
  const decisions = Array.isArray(r.decisions)
    ? r.decisions
        .map((d) => (typeof d === "string" ? d : d && typeof d === "object" ? (d as Record<string, unknown>).text : null))
        .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        .map((d) => d.trim().slice(0, 300))
        .slice(0, 15)
    : [];
  return { summary, decisions };
}
