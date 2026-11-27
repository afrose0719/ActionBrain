// Zero-touch processing (Milestone 29). Pure helpers, so the route stays small and these can be tested without a database.
import type { RawCommitment, RawSuggestion } from "@/lib/ai/actions";

export type ClaimedItem = { id: string; source_type: string; source_ref: string | null; content: string; last_message_at: string };

export type Claim =
  | { status: "ok"; claim: string; provider: string; model: string | null; encrypted_key: string; user_name: string | null; timezone: string; items: ClaimedItem[]; waiting: number }
  | { status: "invalid" | "off" | "no_key" | "nothing" | "quota"; waiting?: number };

/** The analysis request for one claimed conversation. Same shape as the Inbox's own request, so the same prompt applies. */
export function buildUserPrompt(item: ClaimedItem, userName: string | null, timeZone: string, now: Date): string {
  const who = userName?.trim() || "the phone's owner";
  return (
    `The USER is: ${who} (lines starting "You" were written by the USER)\n` +
    `Current time: ${now.toISOString()}\nTimezone: ${timeZone}\n\n` +
    `Message (${item.source_ref ?? item.source_type}):\n<<<\n${item.content}\n>>>`
  );
}

/**
 * What is sent to worker.save_auto_result. Only validated fields go in. The database re-checks every value and decides "sure" by
 * itself, so a tier or any other label here cannot cause a task to be created.
 */
export function toSavePayload(suggestions: RawSuggestion[], commitments: RawCommitment[]) {
  return {
    suggestions: suggestions.map((s) => ({
      title: s.title,
      description: s.description,
      priority: s.priority,
      due_date: s.due_date,
      related_person: s.related_person,
      confidence: s.confidence,
      quote: s.quote,
      language: s.language,
      date_unclear: s.date_unclear,
    })),
    commitments: commitments.map((c) => ({
      direction: c.direction,
      owner_name: c.owner_name,
      counterparty: c.counterparty,
      description: c.description,
      due_date: c.due_date,
      confidence: c.confidence,
      quote: c.quote,
      date_unclear: c.date_unclear,
    })),
  };
}

/** Removes sslmode from the connection string: the TLS settings are given explicitly (see workerSsl). */
export function cleanConnectionString(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("sslmode");
  return u.toString();
}

/**
 * TLS for the worker connection. With WORKER_DATABASE_CA (Supabase's CA certificate, from Database Settings) the server certificate is
 * verified. Without it the connection is still encrypted but the certificate is not verified; docs/zero-touch.md says to set it.
 */
export function workerSsl(ca: string | undefined) {
  return ca?.trim() ? { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true } : { rejectUnauthorized: false };
}

/** "Today, ActionBrain added 3 items automatically": the in-app daily summary. Never shown on a day with nothing added. */
export function summaryLine(items: { auto_created_at: string }[], now: Date): string | null {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = items.filter((i) => new Date(i.auto_created_at) >= start).length;
  return today > 0 ? `Today, ActionBrain added ${today} item${today > 1 ? "s" : ""} automatically.` : null;
}
