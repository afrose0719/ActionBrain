import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LIMITS, readJsonBody, readTextBody } from "../src/lib/body.ts";
import { eventIdFromHeaders } from "../src/lib/intake.ts";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x", { method: "POST", body, headers, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);

test("a body within the limit is read; JSON that is not an object becomes null", async () => {
  const ok = await readJsonBody(post(JSON.stringify({ content: "Send the RCA tomorrow" })), LIMITS.small);
  assert.ok(ok.ok && ok.value.content === "Send the RCA tomorrow");
  for (const bad of ["not json", "[1,2]", "null", ""]) {
    const r = await readJsonBody(post(bad), LIMITS.small);
    assert.ok(r.ok && r.value === null, bad);
  }
});

test("an oversized body is refused with 413, by Content-Length or by counting", async () => {
  const big = "x".repeat(LIMITS.small + 1);
  const r = await readTextBody(post(big), LIMITS.small);
  assert.ok(!r.ok);
  if (!r.ok) assert.equal(r.response.status, 413);

  const lying = await readTextBody(post("{}", { "content-length": String(10 * 1024 * 1024) }), LIMITS.small);
  assert.ok(!lying.ok && lying.response.status === 413, "a declared size over the limit is refused before reading");
});

test("an endless stream is cut off once it passes the limit (it is never fully read)", async () => {
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(4096));
    },
  });
  const r = await readTextBody(post(endless), LIMITS.small);
  assert.ok(!r.ok && r.response.status === 413);
  assert.ok(pulled < 10, `read ${pulled} chunks`);
});

test("multi-byte text (Tamil) is measured in bytes, not characters", async () => {
  const tamil = "நாளை அனுப்புகிறேன் ".repeat(400); // about 3 bytes per character
  assert.ok(tamil.length < 8_000 && new TextEncoder().encode(tamil).length > LIMITS.small);
  const r = await readTextBody(post(tamil), LIMITS.small);
  assert.ok(!r.ok);
  const fits = await readTextBody(post(tamil), LIMITS.medium);
  assert.ok(fits.ok && fits.value === tamil, "decoded back unchanged");
});

test("every JSON API route reads its body through the byte limit", () => {
  const routes = ["command", "google/connect", "inbox/analyze", "meetings/analyze", "microsoft/connect", "microsoft/sync", "search", "settings/ai", "waiting/summary"];
  for (const r of routes) {
    const src = readFileSync(`src/app/api/${r}/route.ts`, "utf8");
    assert.ok(src.includes("readJsonBody(request, LIMITS."), r);
    assert.ok(!src.includes("request.json()"), `${r} still parses an unlimited body`);
  }
  const intake = readFileSync("src/app/api/intake/route.ts", "utf8");
  assert.ok(intake.includes("readTextBody(request,") && !intake.includes("request.text()"));
  // a new route must not slip through
  const all = readdirSync("src/app/api", { recursive: true }).filter((f) => String(f).endsWith("route.ts"));
  for (const f of all) assert.ok(!readFileSync(`src/app/api/${f}`, "utf8").includes("request.json()"), String(f));
});

test("event id header: absent, valid, malformed", () => {
  const h = (v?: string) => new Headers(v === undefined ? {} : { "x-actionbrain-event-id": v });
  assert.equal(eventIdFromHeaders(h()), undefined);
  assert.equal(eventIdFromHeaders(h("6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f")), "6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f");
  assert.equal(eventIdFromHeaders(h("  abcdefgh  ")), "abcdefgh");
  for (const bad of ["short", "has space in it", "x".repeat(65), "drop';--", ""]) assert.equal(eventIdFromHeaders(h(bad)), null, bad);
});

test("Milestone 28: retry-safe intake is locked down and in schema.sql", () => {
  // Windows checkouts turn LF into CRLF; compare the text, not the line endings
  const lf = (file: string) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const sql = lf("supabase/milestone28-event-ids.sql");
  const schema = lf("supabase/schema.sql");
  assert.ok(sql.includes("alter table public.intake_events enable row level security;"));
  assert.ok(!/create policy[^;]*intake_events/i.test(sql), "no policies: only the security-definer function may touch it");
  assert.ok(sql.includes("references auth.users(id) on delete cascade"), "deleted with the account");
  assert.ok(sql.includes("set search_path = ''") && sql.includes("security definer"));
  assert.ok(sql.includes("v_event !~ '^[A-Za-z0-9_-]{8,64}$'"));
  assert.ok(sql.includes("v_result in ('stored', 'duplicate')"), "a refused message is not remembered, so it can be retried");
  assert.ok(sql.includes("interval '30 days'"));
  assert.ok(sql.includes("drop function if exists public.ingest_message(text, text, text, text, boolean, text);"), "no ambiguous overload");
  assert.ok(sql.includes("grant execute on function public.ingest_message(text, text, text, text, boolean, text, text) to anon, authenticated;"));
  const fn = (raw: string) => raw.slice(raw.indexOf("create or replace function public.ingest_message("), raw.indexOf("$$;", raw.indexOf("create or replace function public.ingest_message(")) + 3);
  assert.equal(fn(schema), fn(sql));
  assert.ok(!schema.includes("grant execute on function public.ingest_message(text, text, text, text, boolean, text) to"), "schema.sql grants only the new signature");
});
