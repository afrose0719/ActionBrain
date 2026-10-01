import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  checkEncryptionKey,
  checkGoogle,
  checkSupabaseKey,
  checkSupabaseUrl,
  checkTrackedFiles,
  classifySupabaseKey,
  findSecrets,
} from "../scripts/preflight-lib.mjs";

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2lnbmF0dXJlLWhlcmUtMTIzNDU`;

// ---------------- the most dangerous deployment mistake ----------------

test("classifies Supabase keys: publishable and anon are public, secret and service_role are not", () => {
  assert.equal(classifySupabaseKey("sb_publishable_abc123").kind, "public");
  assert.equal(classifySupabaseKey(jwt({ role: "anon" })).kind, "public");
  assert.equal(classifySupabaseKey("sb_secret_abcdefghijklmnop").kind, "secret");
  assert.equal(classifySupabaseKey(jwt({ role: "service_role" })).kind, "secret");
  assert.equal(classifySupabaseKey("hello").kind, "unknown");
  assert.equal(classifySupabaseKey("").kind, "missing");
  assert.equal(classifySupabaseKey(undefined).kind, "missing");
});

test("a secret key in the browser-facing setting is a hard FAIL that says to rotate it", () => {
  for (const k of ["sb_secret_abcdefghijklmnop", jwt({ role: "service_role" })]) {
    const r = checkSupabaseKey(k);
    assert.equal(r.level, "fail");
    assert.match(r.message, /ROTATE/);
  }
  assert.equal(checkSupabaseKey("sb_publishable_abc").level, "pass");
  assert.equal(checkSupabaseKey(undefined).level, "fail");
  assert.equal(checkSupabaseKey("garbage").level, "warn");
});

// ---------------- other settings ----------------

test("Supabase URL: must be https and look like a project address", () => {
  assert.equal(checkSupabaseUrl("https://abcd.supabase.co").level, "pass");
  assert.equal(checkSupabaseUrl("http://abcd.supabase.co").level, "fail");
  assert.equal(checkSupabaseUrl("not a url").level, "fail");
  assert.equal(checkSupabaseUrl(undefined).level, "fail");
  assert.equal(checkSupabaseUrl("https://example.com").level, "warn");
  assert.equal(checkSupabaseUrl("https://abcd.supabase.co/rest/v1").level, "warn");
});

test("encryption key must decode to exactly 32 bytes", () => {
  assert.equal(checkEncryptionKey(randomBytes(32).toString("base64")).level, "pass");
  assert.equal(checkEncryptionKey(randomBytes(16).toString("base64")).level, "fail");
  assert.equal(checkEncryptionKey(randomBytes(33).toString("base64")).level, "fail");
  assert.equal(checkEncryptionKey("").level, "fail");
  assert.equal(checkEncryptionKey(undefined).level, "fail");
});

test("Google settings: both or neither, never just one", () => {
  assert.equal(checkGoogle({ GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" }).level, "pass");
  assert.equal(checkGoogle({}).level, "warn");
  assert.equal(checkGoogle({ GOOGLE_CLIENT_ID: "a" }).level, "fail");
  assert.equal(checkGoogle({ GOOGLE_CLIENT_SECRET: "b" }).level, "fail");
});

// ---------------- secret scanner ----------------

test("finds real-looking secrets of each kind, and reports names only", () => {
  const cases: [string, string][] = [
    ["Supabase secret key", "const k = 'sb_secret_FAKEFAKEFAKEFAKEFAKEFAKE0123456'"],
    ["Anthropic API key", "ANTHROPIC=sk-ant-api03-abcdefghijklmnopqrstuvwx"],
    ["OpenAI API key", "OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"],
    ["Google API key", "key=AIzaSyA1234567890abcdefghijklmnopqrstuv"],
    ["Google OAuth client secret", "GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuvwx"],
    ["GitHub token", "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["Private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIE..."],
    ["Supabase service_role key", `KEY=${jwt({ role: "service_role", iss: "supabase" })}`],
  ];
  for (const [name, text] of cases) {
    const found = findSecrets(text);
    assert.ok(found.includes(name), `${name} was not detected in: ${text.slice(0, 40)}`);
    assert.ok(!JSON.stringify(found).includes("abcdefghijkl"), "the scanner must never echo the secret itself");
  }
});

test("does NOT flag things that are meant to be public or are obviously fake", () => {
  const safe = [
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_1gpB_NPN4M5WkaUCIaqrcg_ghwdvl_x", // publishable: shipped to browsers on purpose
    `anon=${jwt({ role: "anon" })}`,
    "const fake = 'sk-test-1234567890abcdefghij'", // too short and not a real prefix
    "ANTHROPIC_API_KEY=", // empty template line
    "sb_secret_ is the prefix of secret keys", // prose, no key body
    "const x = 'AIza' // prefix only",
  ];
  for (const text of safe) assert.deepEqual(findSecrets(text), [], text);
});

test("tracked .env files fail, but .env.example is allowed", () => {
  assert.equal(checkTrackedFiles([".env.example", "src/a.ts"])[0].level, "pass");
  assert.equal(checkTrackedFiles([".env.local"])[0].level, "fail");
  assert.equal(checkTrackedFiles(["app/.env"])[0].level, "fail");
  assert.equal(checkTrackedFiles([".env.production"])[0].level, "fail");
});
