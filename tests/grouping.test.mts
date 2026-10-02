import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conversationLabel } from "../src/lib/conversation.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const opts = { locale: "en-GB", timeZone: "UTC" };

// ---- the label on the card ----
test("a single message, or an item from before grouping, has no conversation label", () => {
  assert.equal(conversationLabel({ created_at: "2026-10-02T10:15:00Z", message_count: 1 }, opts), null);
  assert.equal(conversationLabel({ created_at: "2026-10-02T10:15:00Z" }, opts), null);
  assert.equal(conversationLabel({ created_at: "2026-10-02T10:15:00Z", message_count: null }, opts), null);
  assert.equal(conversationLabel({ created_at: "2026-10-02T10:15:00Z", message_count: 0 }, opts), null);
});

test("a conversation on one day shows the count and the time range", () => {
  assert.equal(conversationLabel({ created_at: "2026-10-02T10:15:00Z", last_message_at: "2026-10-02T11:42:00Z", message_count: 12 }, opts), "12 messages · 10:15–11:42");
});

test("a conversation that crossed midnight shows both days", () => {
  assert.equal(
    conversationLabel({ created_at: "2026-10-01T22:10:00Z", last_message_at: "2026-10-02T08:03:00Z", message_count: 5 }, opts),
    "5 messages · 1 Oct, 22:10 – 2 Oct, 08:03",
  );
});

test("two messages with no last time still read well", () => {
  assert.equal(conversationLabel({ created_at: "2026-10-02T10:15:00Z", message_count: 2 }, opts), "2 messages · 10:15–10:15");
});

test("the time zone decides the day boundary", () => {
  const item = { created_at: "2026-10-01T23:30:00Z", last_message_at: "2026-10-02T00:30:00Z", message_count: 3 };
  assert.equal(conversationLabel(item, { locale: "en-GB", timeZone: "UTC" }), "3 messages · 1 Oct, 23:30 – 2 Oct, 00:30");
  assert.equal(conversationLabel(item, { locale: "en-GB", timeZone: "Asia/Kolkata" }), "3 messages · 05:00–06:00"); // both after midnight in India
});

test("an unreadable date gives no label rather than 'Invalid Date'", () => {
  assert.equal(conversationLabel({ created_at: "nonsense", message_count: 4 }, opts), null);
  assert.equal(conversationLabel({ created_at: "2026-10-02T10:15:00Z", last_message_at: "nonsense", message_count: 4 }, opts), null);
});

test("a fractional or silly count is cut to a whole number", () => {
  assert.match(conversationLabel({ created_at: "2026-10-02T10:15:00Z", message_count: 3.9 }, opts) ?? "", /^3 messages/);
  assert.equal(conversationLabel({ created_at: "2026-10-02T10:15:00Z", message_count: Number.NaN }, opts), null);
});

// ---- the rules in the database function (each of these was also run against the real database) ----
const sql26 = read("supabase/milestone26-grouping.sql");
const schema = read("supabase/schema.sql");
const fn = (raw: string) => raw.slice(raw.indexOf("create or replace function public.ingest_message"), raw.indexOf("grant execute on function public.ingest_message"));

test("a conversation stays together while it is ACTIVE: 60 minutes since the LAST message, not 5 since the first", () => {
  const f = fn(sql26);
  assert.ok(f.includes("last_message_at > now() - interval '60 minutes'"));
  assert.ok(!f.includes("interval '5 minutes'"), "the old fixed 5-minute rule must be gone");
  assert.ok(!f.includes("created_at > now() - interval '5 minutes'"));
  assert.ok(f.includes("last_message_at = now(), message_count = message_count + 1"));
});

test("a group chat is ONE item for the group, not one per member; a one-to-one chat is one per person", () => {
  const f = fn(sql26);
  assert.ok(f.includes("'WhatsApp group: ' || v_group"));
  assert.ok(f.includes("'WhatsApp from ' || v_sender"));
  assert.ok(!f.includes("' in ' || v_group end;"), "the old per-member reference must be gone");
});

test("only items you have not analyzed take new lines, so created or dismissed tasks are never disturbed", () => {
  const select = fn(sql26).slice(fn(sql26).indexOf("select * into v_recent"), fn(sql26).indexOf("v_continues := found"));
  assert.ok(select.includes("status = 'new'"));
});

test("a full item continues in a '(continued)' item, and later messages find it", () => {
  const f = fn(sql26);
  assert.ok(f.includes("source_ref in (v_ref, v_ref || ' (continued)')"));
  assert.ok(f.includes("case when v_continues then v_ref || ' (continued)' else v_ref end"));
  assert.ok(f.includes("<= 6000"));
  assert.ok(f.includes("length(source_ref) desc"), "a tie must prefer the newer (continued) item");
});

test("the migration adds the columns, fills old rows, and keeps the safety design", () => {
  assert.ok(sql26.includes("add column if not exists last_message_at timestamptz"));
  assert.ok(sql26.includes("add column if not exists message_count integer not null default 1"));
  assert.ok(sql26.includes("update public.inbox_items set last_message_at = created_at where last_message_at is null"));
  assert.ok(sql26.includes("alter column last_message_at set not null"));
  assert.match(fn(sql26), /security definer\s+set search_path = ''/);
  assert.ok(sql26.includes("grant execute on function public.ingest_message(text, text, text, text, boolean) to anon, authenticated;"));
  assert.ok(!/service_role/i.test(sql26));
  assert.ok(!sql26.includes("drop table") && !sql26.includes("delete from"), "the migration never deletes anything");
});

test("schema.sql has the same columns and the same function as the migration", () => {
  assert.ok(schema.includes("last_message_at timestamptz not null default now()"));
  assert.ok(schema.includes("message_count   integer not null default 1"));
  assert.equal(fn(schema), fn(sql26));
});

test("the Inbox keeps a conversation that is still going on top, and shows the label", () => {
  const inbox = read("src/app/(app)/inbox/page.tsx");
  assert.ok(inbox.includes('.order("last_message_at", { ascending: false })'));
  assert.ok(inbox.includes("conversationLabel(item) ?? new Date(item.created_at).toLocaleString()"));
});

test("preflight checks the new columns", () => {
  assert.ok(read("scripts/preflight.mjs").includes("last_message_at,message_count"));
});
