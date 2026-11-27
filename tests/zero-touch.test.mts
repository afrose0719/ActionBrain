import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildUserPrompt, cleanConnectionString, summaryLine, toSavePayload, workerSsl } from "../src/lib/zero-touch.ts";
import { validateCommitments, validateSuggestions } from "../src/lib/ai/actions.ts";

const lf = (f: string) => readFileSync(f, "utf8").replaceAll("\r\n", "\n");
const sql = lf("supabase/milestone29-zero-touch.sql");
const fn = (name: string) => sql.slice(sql.indexOf(`create or replace function worker.${name}(`), sql.indexOf("$$;", sql.indexOf(`create or replace function worker.${name}(`)) + 3);

test("security: the worker functions are private, and only the worker login may run them", () => {
  assert.ok(sql.includes("create schema if not exists worker;"));
  assert.ok(sql.includes("revoke all on schema worker from anon, authenticated;"));
  assert.ok(sql.includes("revoke all on all functions in schema worker from public, anon, authenticated;"));
  assert.ok(sql.indexOf("revoke all on all functions in schema worker") > sql.lastIndexOf("create or replace function worker."), "revoked after the last function is created");
  assert.ok(!/grant execute[^;]*worker\.[^;]* to (anon|authenticated|public)/i.test(sql));
  assert.ok(!/service_role/i.test(sql));
  for (const name of ["_user_of", "claim_auto_work", "save_auto_result", "fail_auto_work"]) {
    assert.ok(fn(name).includes("set search_path = ''"), name);
  }
});

test("both switches are off by default and checked at claim AND at save", () => {
  assert.ok(sql.includes("add column if not exists auto_analyze boolean not null default false"));
  assert.ok(sql.includes("add column if not exists auto_create  boolean not null default false"));
  assert.ok(fn("claim_auto_work").includes("if not v_ai.auto_analyze then return jsonb_build_object('status', 'off')"));
  assert.ok(fn("save_auto_result").includes("select auto_analyze and auto_create into v_auto"), "re-read at save time");
});

test("quota: reserved inside the claim, locked, never above 50 a day, nothing spent when nothing is ready", () => {
  const claim = fn("claim_auto_work");
  assert.ok(claim.includes("for update;") && claim.includes("50 - v_used"));
  assert.ok(claim.indexOf("v_room <= 0") < claim.indexOf("update public.ai_quota set used = used + cardinality(v_ids)"));
  assert.ok(claim.indexOf("if v_ids is null then") < claim.indexOf("update public.ai_quota"), "no quota used when no item is claimed");
  assert.ok(claim.includes("for update skip locked"), "two claims at once never take the same item");
  assert.ok(claim.includes("interval '10 minutes'") && claim.includes("interval '5 minutes'") && claim.includes("auto_attempts < 3"));
});

test("save: only the claimed item, within its lease; the database decides 'sure' itself", () => {
  const save = fn("save_auto_result");
  assert.ok(save.includes("v_item.auto_claim is distinct from p_claim") && save.includes("auto_lease_until < now()"));
  assert.ok(save.includes("v_conf >= 0.9 and v_quote <> '' and coalesce(s -> 'date_unclear', 'false'::jsonb) = 'false'::jsonb"), "anything but an explicit false counts as unclear");
  assert.ok(save.includes("nullif(btrim(coalesce(c ->> 'owner_name', '')), '') is not null"), "promises need a known owner");
  assert.ok(!save.includes("->> 'tier'"), "a tier sent by the caller is never read");
  assert.ok(save.includes("on conflict (user_id, auto_key) where auto_key is not null do nothing"), "no duplicate tasks");
  assert.ok(save.includes("where n <= 10"), "at most 10 items of each kind");
  assert.ok(!save.includes("::boolean"), "a malformed date_unclear cannot crash the save");
});

test("schema.sql carries Milestone 29", () => {
  const schema = lf("supabase/schema.sql");
  for (const name of ["claim_auto_work", "save_auto_result", "fail_auto_work", "_user_of", "_ts"]) {
    assert.ok(schema.includes(`create or replace function worker.${name}(`), name);
  }
  assert.ok(schema.includes("create table if not exists public.ai_quota"));
});

test("the route: write-only token in, counts out, never message text", () => {
  const route = lf("src/app/api/intake/process/route.ts");
  assert.ok(route.includes("select worker.claim_auto_work($1, $2)"));
  assert.ok(route.includes("process.env.WORKER_DATABASE_URL"));
  assert.ok(!/content|source_ref|quote/.test(route.slice(route.lastIndexOf("return Response.json("))), "the final answer holds counts only");
  assert.ok(route.includes("INBOX_SYSTEM_PROMPT"), "same prompt as the Analyze button");
  assert.ok(route.includes("release(item.id)"), "a failed AI call releases the item");
});

test("payload: only validated fields; a label from the model cannot sneak through", () => {
  const raw = {
    suggestions: [{ title: "Submit the RCA", confidence: 0.95, quote: "Tomorrow submit the RCA", tier: "high", user_id: "x", status: "done" }],
    commitments: [{ direction: "theirs", owner: "Vignesh", description: "Send spec", confidence: 0.92, quote: "I will send", tier: "high" }],
  };
  const p = toSavePayload(validateSuggestions(raw), validateCommitments(raw));
  assert.deepEqual(Object.keys(p.suggestions[0]).sort(), ["confidence", "date_unclear", "description", "due_date", "language", "priority", "quote", "related_person", "title"]);
  assert.ok(!("tier" in p.commitments[0]) && p.commitments[0].owner_name === "Vignesh");
});

test("prompt: the conversation is fenced as data, with the user's name and time zone", () => {
  const out = buildUserPrompt(
    { id: "1", source_type: "whatsapp", source_ref: "WhatsApp from Priya", content: "naalaiku report anupuren", last_message_at: "2026-11-27T10:00:00Z" },
    "Afrose", "Asia/Kolkata", new Date("2026-11-27T10:15:00Z")
  );
  assert.ok(out.includes("The USER is: Afrose") && out.includes("Timezone: Asia/Kolkata") && out.includes("<<<\nnaalaiku report anupuren\n>>>"));
  assert.ok(buildUserPrompt({ id: "1", source_type: "teams", source_ref: null, content: "x", last_message_at: "" }, null, "UTC", new Date()).includes("the phone's owner"));
});

test("worker connection: sslmode removed, certificate verified when a CA is given", () => {
  assert.equal(cleanConnectionString("postgresql://u:p@host:6543/postgres?sslmode=require"), "postgresql://u:p@host:6543/postgres");
  assert.deepEqual(workerSsl("-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----"), { ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  assert.deepEqual(workerSsl(undefined), { rejectUnauthorized: false });
});

test("daily summary: only on a day something was added", () => {
  const now = new Date("2026-11-27T18:00:00");
  assert.equal(summaryLine([], now), null);
  assert.equal(summaryLine([{ auto_created_at: "2026-11-25T10:00:00" }], now), null);
  assert.equal(summaryLine([{ auto_created_at: "2026-11-27T09:00:00" }, { auto_created_at: "2026-11-27T11:00:00" }], now), "Today, ActionBrain added 2 items automatically.");
});

test("keep-alive: one daily Vercel cron, protected by CRON_SECRET, reads nothing", () => {
  const vercel = JSON.parse(lf("vercel.json"));
  assert.deepEqual(vercel.crons.map((c: { path: string }) => c.path), ["/api/cron/keepalive"]);
  const route = lf("src/app/api/cron/keepalive/route.ts");
  assert.ok(route.includes("process.env.CRON_SECRET") && route.includes("select=id&limit=1"));
  assert.ok(!route.includes("SERVICE_ROLE"));
});

test("Android: the background job is platform-only, not exported, and never cancels a scheduled run", () => {
  const manifest = lf("android/app/src/main/AndroidManifest.xml");
  assert.match(manifest, /android:name="\.AutoProcessJob"\s+android:exported="false"\s+android:permission="android\.permission\.BIND_JOB_SERVICE"/);
  assert.doesNotMatch(manifest, /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  const job = lf("android/app/src/main/java/app/actionbrain/android/AutoProcess.kt");
  assert.ok(job.includes("if (scheduler.getPendingJob(JOB_SOON) != null) return"));
  const gradle = lf("android/app/build.gradle.kts");
  assert.ok(!/work-runtime/.test(gradle), "no WorkManager library: Android's JobScheduler is used");
});
