import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

// Runs the REAL SQL (schema.sql + Milestones 28 and 29) in a real Postgres (PGlite, Postgres compiled to WebAssembly), with small
// stand-ins for what Supabase provides (auth.users, auth.uid(), the anon role). Review round 6 evidence: behaviour, not just text.

const USER = "11111111-1111-1111-1111-111111111111";
const TOKEN = "abi_" + "A".repeat(43);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
    create role anon; create role authenticated;
  `);
  await db.exec(readFileSync("supabase/schema.sql", "utf8"));
  await db.exec(readFileSync("supabase/milestone28-event-ids.sql", "utf8")); // safe to run again
  await db.exec(readFileSync("supabase/milestone29-zero-touch.sql", "utf8"));
  const hash = createHash("sha256").update(TOKEN).digest("hex");
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@example.com', '{"full_name":"Afrose"}')`, [USER]);
  await db.query(`insert into public.intake_settings (user_id, token_hash, timezone) values ($1, $2, 'Asia/Kolkata')`, [USER, hash]);
  await db.query(`insert into public.user_ai_settings (user_id, provider, encrypted_key) values ($1, 'anthropic', 'CIPHERTEXT')`, [USER]);
  const val = async <T,>(sql: string, params: unknown[] = []) => ((await db.query<{ r: T }>(sql, params)).rows[0] as { r: T }).r;
  const ingest = (sender: string, text: string, ev: string | null = null) =>
    val<string>(`select public.ingest_message($1, $2, $3, null, false, 'whatsapp', $4) as r`, [TOKEN, sender, text, ev]);
  const quiet = () => db.query(`update public.inbox_items set last_message_at = now() - interval '11 minutes' where status = 'new'`);
  type Claim = { status: string; claim: string; items: { id: string }[]; user_name: string; timezone: string; encrypted_key: string; waiting: number };
  const claim = () => val<Claim>(`select worker.claim_auto_work($1, 3) as r`, [TOKEN]);
  const save = (c: string, item: string, s: unknown[], m: unknown[]) =>
    val<{ status: string; added_tasks: number; added_commitments: number }>(`select worker.save_auto_result($1, $2, $3, $4::jsonb, $5::jsonb) as r`, [TOKEN, c, item, JSON.stringify(s), JSON.stringify(m)]);
  return { db, val, ingest, quiet, claim, save };
}

const SUGG = [
  { title: "Submit the RCA", confidence: 0.95, quote: "Tomorrow submit the RCA.", due_date: "2026-11-28T09:00:00+05:30" },
  { title: "Maybe call", confidence: 0.7, quote: "call", tier: "high" },
  { title: "Guessed date", confidence: 0.99, quote: "kal", date_unclear: true },
  { title: "Garbage flag", confidence: 0.99, quote: "x", date_unclear: "yes", due_date: "not a date" },
];
const COMMS = [
  { direction: "theirs", owner_name: "Priya", description: "Send the logs", confidence: 0.93, quote: "I will send the logs" },
  { direction: "theirs", owner_name: null, description: "No owner", confidence: 0.99, quote: "someone will" },
  { direction: "everyone", description: "bad direction", confidence: 0.99, quote: "x" },
];

test("Milestone 28: the same event id is stored once; a malformed id is refused", async () => {
  const { ingest } = await setup();
  assert.equal(await ingest("Priya", "Tomorrow submit the RCA.", "evt-00000001"), "stored");
  assert.equal(await ingest("Priya", "Tomorrow submit the RCA.", "evt-00000001"), "duplicate");
  assert.equal(await ingest("Priya", "Tomorrow submit the RCA.", "bad id!"), "invalid");
});

test("Milestone 29: off by default; nothing before 10 quiet minutes; a claim leases items and spends quota", async () => {
  const { db, ingest, quiet, claim } = await setup();
  await ingest("Priya", "Tomorrow submit the RCA.");
  assert.equal((await claim()).status, "off", "auto_analyze is off by default");
  await db.query(`update public.user_ai_settings set auto_analyze = true`);
  const early = await claim();
  assert.equal(early.status, "nothing");
  assert.equal(early.waiting, 1);
  await quiet();
  const c = await claim();
  assert.equal(c.status, "ok");
  assert.equal(c.items.length, 1);
  assert.equal(c.user_name, "Afrose");
  assert.equal(c.timezone, "Asia/Kolkata");
  assert.equal(((await db.query<{ used: number }>(`select used from public.ai_quota`)).rows[0]).used, 1);
  assert.equal((await claim()).status, "nothing", "a leased item is not claimed twice");
});

test("save: suggestions only while auto-create is off; the database decides what is sure", async () => {
  const { db, ingest, quiet, claim, save } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true`);
  await ingest("Priya", "Tomorrow submit the RCA.");
  await quiet();
  const c = await claim();
  const item = c.items[0].id;
  assert.equal((await save("00000000-0000-0000-0000-000000000000", item, SUGG, COMMS)).status, "not_claimed");
  const r = await save(c.claim, item, SUGG, COMMS);
  assert.deepEqual([r.status, r.added_tasks, r.added_commitments], ["saved", 0, 0]);
  assert.equal(((await db.query<{ n: number }>(`select count(*)::int n from public.tasks`)).rows[0]).n, 0);
  const row = (await db.query<{ ai_suggestions: { title: string; tier: string }[]; status: string }>(`select ai_suggestions, status from public.inbox_items where id = $1`, [item])).rows[0];
  assert.equal(row.status, "analyzed");
  assert.deepEqual(row.ai_suggestions.map((s) => `${s.title}=${s.tier}`), ["Submit the RCA=high", "Maybe call=review", "Guessed date=review", "Garbage flag=review"]);
  const comms = (await db.query<{ description: string; status: string }>(`select description, status from public.commitments order by description`)).rows;
  assert.deepEqual(comms, [{ description: "No owner", status: "suggested" }, { description: "Send the logs", status: "suggested" }], "bad direction dropped");
  assert.equal((await save(c.claim, item, SUGG, COMMS)).status, "not_claimed", "a finished item cannot be saved twice");
});

test("auto-create on: only sure items are added, with provenance; owner-less promises wait", async () => {
  const { db, ingest, quiet, claim, save } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true, auto_create = true`);
  await ingest("Ravi", "Please share the invoice by Friday");
  await quiet();
  const c = await claim();
  const r = await save(c.claim, c.items[0].id, SUGG, COMMS);
  assert.deepEqual([r.added_tasks, r.added_commitments], [1, 1]);
  const tasks = (await db.query<{ title: string; auto: boolean; ai_generated: boolean }>(`select title, auto_created_at is not null as auto, ai_generated from public.tasks`)).rows;
  assert.deepEqual(tasks, [{ title: "Submit the RCA", auto: true, ai_generated: true }], "a garbage date flag counts as unclear");
  const open = (await db.query<{ description: string }>(`select description from public.commitments where status = 'open' and auto_created_at is not null`)).rows;
  assert.deepEqual(open.map((x) => x.description), ["Send the logs"]);
});

test("switching auto-create off after the claim stops the insert", async () => {
  const { db, ingest, quiet, claim, save } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true, auto_create = true`);
  await ingest("Ravi", "Please share the invoice by Friday");
  await quiet();
  const c = await claim();
  await db.query(`update public.user_ai_settings set auto_create = false`);
  const r = await save(c.claim, c.items[0].id, SUGG, COMMS);
  assert.deepEqual([r.added_tasks, r.added_commitments], [0, 0]);
});

test("quota: no claim beyond 50 a day; unknown token refused", async () => {
  const { db, ingest, quiet, claim, val } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true`);
  await db.query(`insert into public.ai_quota (user_id, day, used) values ($1, current_date, 50)`, [USER]);
  await ingest("Kumar", "Send the deck tomorrow");
  await quiet();
  assert.equal((await claim()).status, "quota");
  assert.equal((await val<{ status: string }>(`select worker.claim_auto_work($1, 3) as r`, ["abi_" + "B".repeat(43)])).status, "invalid");
});

test("privileges: anon cannot run worker functions; the worker role can, but cannot read any table", async () => {
  const { db } = await setup();
  await db.exec(`set role anon`);
  await assert.rejects(db.query(`select worker.claim_auto_work($1, 3)`, [TOKEN]), /permission denied/);
  await db.exec(`reset role`);
  await db.exec(`
    create role actionbrain_worker noinherit;
    grant usage on schema worker to actionbrain_worker;
    grant execute on function worker.claim_auto_work(text, integer), worker.save_auto_result(text, uuid, uuid, jsonb, jsonb), worker.fail_auto_work(text, uuid, uuid) to actionbrain_worker;
  `);
  await db.exec(`set role actionbrain_worker`);
  const r = (await db.query<{ r: { status: string } }>(`select worker.claim_auto_work($1, 3) as r`, [TOKEN])).rows[0].r;
  assert.equal(r.status, "off");
  await assert.rejects(db.query(`select * from public.inbox_items`), /permission denied/);
  await assert.rejects(db.query(`select * from public.user_ai_settings`), /permission denied/);
  await db.exec(`reset role`);
});
