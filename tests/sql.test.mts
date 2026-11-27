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

// the captured conversation these replies are about (quotes are checked against it)
const MESSAGE = "Tomorrow submit the RCA. I will send the logs. someone will check kal";
const SUGG = [
  { title: "Submit the RCA", confidence: 0.95, quote: "tomorrow   SUBMIT the RCA.", due_date: "2026-11-28T09:00:00+05:30", date_unclear: false },
  { title: "Maybe call", confidence: 0.7, quote: "Tomorrow submit", tier: "high", date_unclear: false },
  { title: "Guessed date", confidence: 0.99, quote: "check kal", date_unclear: true },
  { title: "Garbage flag", confidence: 0.99, quote: "I will send the logs", date_unclear: "yes", due_date: "not a date" },
  { title: "No flag at all", confidence: 0.99, quote: "I will send the logs" },
  { title: "Invented quote", confidence: 0.99, quote: "I promise to pay you 1 lakh", date_unclear: false },
];
const COMMS = [
  { direction: "theirs", owner_name: "Priya", description: "Send the logs", confidence: 0.93, quote: "I will send the logs", date_unclear: false },
  { direction: "theirs", owner_name: null, description: "No owner", confidence: 0.99, quote: "someone will check", date_unclear: false },
  { direction: "everyone", description: "bad direction", confidence: 0.99, quote: "x", date_unclear: false },
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
  await ingest("Priya", MESSAGE);
  await quiet();
  const c = await claim();
  const item = c.items[0].id;
  assert.equal((await save("00000000-0000-0000-0000-000000000000", item, SUGG, COMMS)).status, "not_claimed");
  const r = await save(c.claim, item, SUGG, COMMS);
  assert.deepEqual([r.status, r.added_tasks, r.added_commitments], ["saved", 0, 0]);
  assert.equal(((await db.query<{ n: number }>(`select count(*)::int n from public.tasks`)).rows[0]).n, 0);
  const row = (await db.query<{ ai_suggestions: { title: string; tier: string }[]; status: string }>(`select ai_suggestions, status from public.inbox_items where id = $1`, [item])).rows[0];
  assert.equal(row.status, "analyzed");
  assert.deepEqual(row.ai_suggestions.map((s) => `${s.title}=${s.tier}`), [
    "Submit the RCA=high", // case and spacing differ from the message: still found
    "Maybe call=review",
    "Guessed date=review",
    "Garbage flag=review", // a malformed date flag is unclear
    "No flag at all=review", // a missing date flag is unclear (round 6: only explicit false is clear)
    "Invented quote=review", // the quote is not in the message
  ]);
  const comms = (await db.query<{ description: string; status: string }>(`select description, status from public.commitments order by description`)).rows;
  assert.deepEqual(comms, [{ description: "No owner", status: "suggested" }, { description: "Send the logs", status: "suggested" }], "bad direction dropped");
  assert.equal((await save(c.claim, item, SUGG, COMMS)).status, "not_claimed", "a finished item cannot be saved twice");
});

test("auto-create on: only sure items are added, with provenance; owner-less promises wait", async () => {
  const { db, ingest, quiet, claim, save } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true, auto_create = true`);
  await ingest("Ravi", MESSAGE);
  await quiet();
  const c = await claim();
  const r = await save(c.claim, c.items[0].id, SUGG, COMMS);
  assert.deepEqual([r.added_tasks, r.added_commitments], [1, 1]);
  const tasks = (await db.query<{ title: string; auto: boolean; ai_generated: boolean }>(`select title, auto_created_at is not null as auto, ai_generated from public.tasks`)).rows;
  assert.deepEqual(tasks, [{ title: "Submit the RCA", auto: true, ai_generated: true }], "unclear dates and invented quotes are never added");
  const open = (await db.query<{ description: string }>(`select description from public.commitments where status = 'open' and auto_created_at is not null`)).rows;
  assert.deepEqual(open.map((x) => x.description), ["Send the logs"]);
});

test("switching auto-create off after the claim stops the insert", async () => {
  const { db, ingest, quiet, claim, save } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true, auto_create = true`);
  await ingest("Ravi", MESSAGE);
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

test("leases: an abandoned claim is picked up again after 5 minutes, at most 3 attempts; a wrong claim cannot release it", async () => {
  const { db, ingest, quiet, claim, val } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true`);
  await ingest("Priya", MESSAGE);
  await quiet();
  const first = await claim();
  assert.equal(await val(`select worker.fail_auto_work($1, gen_random_uuid(), $2) as r`, [TOKEN, first.items[0].id]), "not_claimed");
  for (let attempt = 2; attempt <= 3; attempt++) {
    await db.query(`update public.inbox_items set auto_lease_until = now() - interval '1 second'`); // the server crashed
    assert.equal((await claim()).status, "ok", `attempt ${attempt}`);
  }
  await db.query(`update public.inbox_items set auto_lease_until = now() - interval '1 second'`);
  assert.equal((await claim()).status, "nothing", "after 3 attempts the conversation waits for a person");
});

test("waiting: the server reports conversations still inside their quiet period, so the phone runs again", async () => {
  const { db, ingest, quiet, claim } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true`);
  await ingest("Priya", MESSAGE);
  await quiet();
  await ingest("Ravi", "please send the deck");
  const c = await claim();
  assert.equal(c.status, "ok");
  assert.equal(c.waiting, 1);
});

test("Undo: a deleted automatic task is not re-created (the conversation is already done)", async () => {
  const { db, ingest, quiet, claim, save } = await setup();
  await db.query(`update public.user_ai_settings set auto_analyze = true, auto_create = true`);
  await ingest("Priya", MESSAGE);
  await quiet();
  const c = await claim();
  await save(c.claim, c.items[0].id, SUGG, COMMS);
  await db.query(`delete from public.tasks`); // Undo
  assert.equal((await claim()).status, "nothing");
  assert.equal(((await db.query<{ n: number }>(`select count(*)::int n from public.tasks`)).rows[0]).n, 0);
});

test("the worker login belongs to no other role and cannot switch to one or create objects", async () => {
  const { db } = await setup();
  await db.exec(`create role actionbrain_worker noinherit; grant usage on schema worker to actionbrain_worker;`);
  const member = (await db.query<{ n: number }>(`select count(*)::int n from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'actionbrain_worker'`)).rows[0].n;
  assert.equal(member, 0);
  // (SET ROLE cannot be tested here: PGlite's session user is a superuser. On Supabase the worker logs in as itself.)
  const can = (sql: string) => db.query<{ ok: boolean }>(sql).then((r) => r.rows[0].ok);
  assert.equal(await can(`select pg_has_role('actionbrain_worker', 'postgres', 'MEMBER') as ok`), false);
  assert.equal(await can(`select has_schema_privilege('actionbrain_worker', 'worker', 'CREATE') as ok`), false);
  assert.equal(await can(`select has_schema_privilege('actionbrain_worker', 'public', 'CREATE') as ok`), false);
  assert.equal(await can(`select has_table_privilege('actionbrain_worker', 'public.tasks', 'SELECT') as ok`), false);
});
