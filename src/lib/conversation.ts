// The Inbox shows a conversation that arrived in pieces (phone messages) as ONE card. This builds the line that says so,
// for example "12 messages · 10:15–11:42". Pure, so it can be tested without a browser.

export type ConversationSpan = {
  created_at: string;
  /** When the newest line arrived. Missing on rows from before Milestone 26. */
  last_message_at?: string | null;
  message_count?: number | null;
};

type Options = { locale?: string; timeZone?: string };

/**
 * "12 messages · 10:15–11:42" (same day) or "12 messages · 1 Oct, 22:10 – 2 Oct, 08:03".
 * Null for an item with a single message (or an unreadable date): the caller then shows the plain date as before.
 */
export function conversationLabel(item: ConversationSpan, options: Options = {}): string | null {
  const count = item.message_count ?? 1;
  if (!Number.isFinite(count) || count <= 1) return null;

  const start = new Date(item.created_at);
  const end = new Date(item.last_message_at ?? item.created_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  const { locale, timeZone } = options;
  const time = (d: Date) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone });
  const day = (d: Date) => d.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone });
  const noun = `${Math.floor(count)} messages`;

  if (day(start) === day(end)) return `${noun} · ${time(start)}–${time(end)}`;
  return `${noun} · ${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}
