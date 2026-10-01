import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { healthReport } from "../src/lib/health.ts";

const goodKey = randomBytes(32).toString("base64");
const NOW = new Date("2026-10-05T10:00:00Z");

test("ok when Supabase and the encryption key are configured", () => {
  const r = healthReport({ NEXT_PUBLIC_SUPABASE_URL: "https://a.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x", AI_KEY_ENCRYPTION_KEY: goodKey }, NOW);
  assert.deepEqual(r, { status: "ok", checks: { supabase: true, encryptionKey: true }, time: "2026-10-05T10:00:00.000Z" });
});

test("degraded when anything is missing or malformed", () => {
  assert.equal(healthReport({}, NOW).status, "degraded");
  assert.equal(healthReport({ NEXT_PUBLIC_SUPABASE_URL: "https://a", AI_KEY_ENCRYPTION_KEY: goodKey }, NOW).checks.supabase, false); // no key
  assert.equal(healthReport({ NEXT_PUBLIC_SUPABASE_URL: "https://a", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k", AI_KEY_ENCRYPTION_KEY: "short" }, NOW).checks.encryptionKey, false);
});

test("the report never contains a secret value, only booleans", () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://secret-project.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_VALUE", AI_KEY_ENCRYPTION_KEY: goodKey, GOOGLE_CLIENT_SECRET: "GOCSPX-nope" };
  const text = JSON.stringify(healthReport(env, NOW));
  for (const secret of [goodKey, "secret-project", "sb_publishable_VALUE", "GOCSPX-nope"]) assert.ok(!text.includes(secret), `leaked: ${secret}`);
  for (const v of Object.values(healthReport(env, NOW).checks)) assert.equal(typeof v, "boolean");
});
