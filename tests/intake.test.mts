import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateToken, hashToken, looksLikeToken, parseSenderList, readNotification, tokenFromHeaders } from "../src/lib/intake.ts";

const headers = (h: Record<string, string>) => new Headers(h);
const ok = (r: ReturnType<typeof readNotification>) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return (r as Extract<typeof r, { ok: true }>).message;
};
const why = (r: ReturnType<typeof readNotification>) => {
  assert.equal(r.ok, false, JSON.stringify(r));
  return (r as Extract<typeof r, { ok: false }>).reason;
};

// ---- tokens ----
test("a token is 'abi_' plus 43 URL-safe characters and is different every time", () => {
  const a = generateToken();
  const b = generateToken();
  assert.match(a, /^abi_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(looksLikeToken(a), true);
});

test("looksLikeToken rejects anything else", () => {
  for (const bad of [undefined, null, 5, "", "abi_short", "xyz_" + "a".repeat(43), "abi_" + "a".repeat(44), "abi_" + "a".repeat(42) + "!", " abi_" + "a".repeat(43)]) {
    assert.equal(looksLikeToken(bad), false, String(bad));
  }
});

test("the stored hash is plain SHA-256 in lowercase hex (the database computes the same thing)", async () => {
  assert.equal(await hashToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const h = await hashToken(generateToken());
  assert.match(h, /^[0-9a-f]{64}$/);
});

test("tokenFromHeaders reads Bearer or x-actionbrain-token, and only a well-formed token", () => {
  const t = generateToken();
  assert.equal(tokenFromHeaders(headers({ authorization: `Bearer ${t}` })), t);
  assert.equal(tokenFromHeaders(headers({ authorization: `bearer   ${t}` })), t);
  assert.equal(tokenFromHeaders(headers({ "x-actionbrain-token": t })), t);
  assert.equal(tokenFromHeaders(headers({})), null);
  assert.equal(tokenFromHeaders(headers({ authorization: "Bearer nope" })), null);
  assert.equal(tokenFromHeaders(headers({ authorization: t.slice(1) })), null);
});

// ---- sender list ----
test("parseSenderList splits on lines, commas and semicolons, trims, drops blanks and repeats", () => {
  assert.deepEqual(parseSenderList("Rajesh, Priya\n\n  Mom ;rajesh\nDr. Rao"), ["Rajesh", "Priya", "Mom", "Dr. Rao"]);
  assert.deepEqual(parseSenderList("  \n ,, "), []);
});

test("parseSenderList caps the count and the length of names", () => {
  const many = Array.from({ length: 300 }, (_, i) => `person${i}`).join("\n");
  assert.equal(parseSenderList(many).length, 100);
  assert.equal(parseSenderList("x".repeat(500))[0].length, 100);
});

// ---- notifications ----
test("plain text: first line is the sender, the rest is the message", () => {
  const m = ok(readNotification("text/plain", 'Rajesh\nCan you send the RCA by Friday?\nAlso "quotes" and \\ are fine'));
  assert.deepEqual(m, { sender: "Rajesh", text: 'Can you send the RCA by Friday?\nAlso "quotes" and \\ are fine', group: null, mine: false });
});

test("JSON works, with sender/message as aliases", () => {
  assert.deepEqual(ok(readNotification("application/json", JSON.stringify({ title: "Priya", text: "Call me" }))), { sender: "Priya", text: "Call me", group: null, mine: false });
  assert.deepEqual(ok(readNotification("application/json; charset=utf-8", JSON.stringify({ sender: "Priya", message: "Call me", group: "Team", mine: false }))), { sender: "Priya", text: "Call me", group: "Team", mine: false });
});

test("broken or non-object JSON is 'invalid'", () => {
  assert.equal(why(readNotification("application/json", "{not json")), "invalid");
  assert.equal(why(readNotification("application/json", "[1,2]")), "empty"); // an array has no title or text
  assert.equal(why(readNotification("application/json", "null")), "invalid");
});

test("empty bodies and a title with no message are ignored", () => {
  assert.equal(why(readNotification("text/plain", "")), "empty");
  assert.equal(why(readNotification("text/plain", "   \n  ")), "empty");
  assert.equal(why(readNotification("application/json", JSON.stringify({ title: "Rajesh" }))), "empty");
});

test("WhatsApp's own system notifications are ignored", () => {
  for (const text of ["Checking for new messages", "WhatsApp Web is currently active", "Backup in progress", "3 new messages", "5 messages from 2 chats", "Ongoing voice call", "Missed voice call"]) {
    assert.equal(why(readNotification("text/plain", `Someone\n${text}`)), "system", text);
  }
  assert.equal(why(readNotification("text/plain", "WhatsApp\nanything at all")), "system");
});

test("photos, voice notes and emoji-only messages carry no words, so they are ignored", () => {
  for (const text of ["📷 Photo", "🎤 Voice message (0:12)", "Video", "Sticker", "👍", "🙏🙏", "...", "🎵 Audio"]) {
    assert.equal(why(readNotification("text/plain", `Rajesh\n${text}`)), "no-text", text);
  }
});

test("real messages that merely mention those words are kept", () => {
  for (const text of ["Photo of the invoice attached, please check", "Can you send the video by Monday?", "3 new messages from the client need replies"]) {
    ok(readNotification("text/plain", `Rajesh\n${text}`));
  }
});

test("a '(3 messages)' suffix on a 1:1 chat title is removed", () => {
  assert.equal(ok(readNotification("text/plain", "Rajesh (3 messages)\nPlease call back")).sender, "Rajesh");
  assert.equal(ok(readNotification("text/plain", "Rajesh (1 message)\nPlease call back")).sender, "Rajesh");
});

test("a 'Group: Sender' title is a group message; the sender is the person", () => {
  assert.deepEqual(ok(readNotification("text/plain", "Project Team: Priya\nUpdate the deck by Friday")), { sender: "Priya", text: "Update the deck by Friday", group: "Project Team", mine: false });
});

test("a single line is the message itself, from 'Unknown'; long input is cut", () => {
  assert.equal(ok(readNotification("text/plain", "Just a message with no title")).sender, "Unknown");
  const m = ok(readNotification("text/plain", `${"N".repeat(300)}\n${"w ".repeat(2000)}`));
  assert.equal(m.sender.length, 100);
  assert.ok(m.text.length <= 1500);
});

test("control characters are removed and Windows line endings normalised", () => {
  const m = ok(readNotification("text/plain", "Raj\u0000esh\r\nLine one\r\nLine two"));
  assert.equal(m.sender, "Rajesh");
  assert.equal(m.text, "Line one\nLine two");
});

test("Hindi and other scripts count as text", () => {
  ok(readNotification("text/plain", "राजेश\nकल रिपोर्ट भेज देना"));
});

// ---- the SQL and the TypeScript must agree ----
const sql = readFileSync(new URL("../supabase/milestone22-intake.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

test("the database function uses the same token pattern and hash as the code", () => {
  assert.ok(sql.includes("'^abi_[A-Za-z0-9_-]{43}$'"));
  assert.ok(sql.includes("encode(sha256(convert_to(p_token, 'UTF8')), 'hex')"));
});

test("the function is locked down: definer, empty search_path, no public execute, no service role", () => {
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.ok(sql.includes("revoke all on function public.ingest_message(text, text, text, text, boolean) from public;"));
  assert.ok(sql.includes("grant execute on function public.ingest_message(text, text, text, text, boolean) to anon, authenticated;"));
  assert.ok(!/service_role/i.test(sql));
});

test("the token table has Row Level Security and owner-only policies, and no anonymous access", () => {
  assert.ok(sql.includes("alter table public.intake_settings enable row level security;"));
  for (const verb of ["select", "insert", "update", "delete"]) assert.ok(new RegExp(`for ${verb}`).test(sql), verb);
  assert.ok(!/to anon/.test(sql.replace("to anon, authenticated;", "")), "only the function may be granted to anon");
});

test("only the hash is stored: the table has no plain token column", () => {
  const table = sql.slice(sql.indexOf("create table"), sql.indexOf(");", sql.indexOf("create table")));
  assert.ok(table.includes("token_hash"));
  assert.ok(!/\btoken\s+text/.test(table));
});

test("schema.sql carries the same function body as the milestone file", () => {
  const fn = (raw: string) => {
    const text = raw.replace(/\r\n/g, "\n"); // schema.sql and the milestone file may use different line endings
    return text.slice(text.indexOf("create or replace function public.ingest_message"), text.indexOf("grant execute on function public.ingest_message"));
  };
  assert.equal(fn(schema), fn(sql));
  assert.ok(schema.includes("create table if not exists public.intake_settings"));
});

test("the abuse limits are in the function", () => {
  assert.ok(sql.includes(">= 300"));
  assert.ok(sql.includes("<= 6000"));
  assert.ok(sql.includes("left(btrim(coalesce(p_text, '')), 1500)"));
});

test("JSON can mark a message as written by you (the Android app reads your own messages from the open chat)", () => {
  const m = ok(readNotification("application/json", JSON.stringify({ title: "Rajesh", text: "I will send it tomorrow", mine: true })));
  assert.deepEqual(m, { sender: "Rajesh", text: "I will send it tomorrow", group: null, mine: true });
});

test("only a real boolean true counts as mine", () => {
  for (const mine of ["true", 1, "yes", null, {}]) {
    assert.equal(ok(readNotification("application/json", JSON.stringify({ title: "Rajesh", text: "hello there", mine }))).mine, false, String(mine));
  }
});

test("plain text is never 'mine'", () => {
  assert.equal(ok(readNotification("text/plain", "Rajesh\nhello there")).mine, false);
});

test("the Milestone 24 SQL adds p_mine, drops the old function, and says 'You' for your own messages", () => {
  const sql24 = readFileSync(new URL("../supabase/milestone24-screen.sql", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(sql24.includes("drop function if exists public.ingest_message(text, text, text, text);"));
  assert.ok(sql24.includes("p_mine boolean default false"));
  assert.ok(sql24.includes("'You ('"));
  assert.ok(sql24.includes("grant execute on function public.ingest_message(text, text, text, text, boolean) to anon, authenticated;"));
  assert.ok(sql24.includes("security definer"));
  assert.ok(!/service_role/i.test(sql24));
  // the other milestone file and schema.sql carry the same function body
  const body = (raw: string) => {
    const t = raw.replace(/\r\n/g, "\n");
    return t.slice(t.indexOf("create or replace function public.ingest_message"), t.indexOf("grant execute on function public.ingest_message"));
  };
  assert.equal(body(sql24), body(schema));
  assert.equal(body(sql24), body(sql));
});
