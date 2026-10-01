#!/usr/bin/env node
// `npm run preflight`: checks that this project is ready to deploy. It changes nothing.
//   - reads .env.local (and real environment variables, which win)
//   - checks your settings, your Supabase database, and your git repo for leaked secrets
// Exit code 1 if anything FAILS, so it can also gate a deployment.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  checkEncryptionKey,
  checkGoogle,
  checkSupabaseKey,
  checkSupabaseUrl,
  checkTrackedFiles,
  classifySupabaseKey,
  findSecrets,
} from "./preflight-lib.mjs";

const results = [];
const add = (section, r) => results.push({ section, ...r });
const pass = (m) => ({ level: "pass", message: m });
const warn = (m) => ({ level: "warn", message: m });
const fail = (m) => ({ level: "fail", message: m });

// ---------- environment ----------
function loadEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const env = { ...loadEnvFile(".env.local"), ...process.env };
const SECTION_ENV = "Settings";
if (!existsSync(".env.local") && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  add(SECTION_ENV, warn("No .env.local found. Checking your shell's environment variables instead."));
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
add(SECTION_ENV, checkSupabaseUrl(url));
add(SECTION_ENV, checkSupabaseKey(key));
add(SECTION_ENV, checkEncryptionKey(env.AI_KEY_ENCRYPTION_KEY));
add(SECTION_ENV, checkGoogle(env));

// ---------- database (only if the key is the safe public kind) ----------
const SECTION_DB = "Database";
const canProbe = url && key && classifySupabaseKey(key).kind === "public" && checkSupabaseUrl(url).level !== "fail";
if (!canProbe) {
  add(SECTION_DB, warn("Skipped, because the Supabase URL or key above is missing or unsafe."));
} else {
  const base = url.replace(/\/$/, "");
  const headers = { apikey: key, "content-type": "application/json" };
  const call = async (path, init = {}) => {
    try {
      const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch (e) {
      return { status: 0, body: { message: String(e?.message ?? e) } };
    }
  };

  const reach = await call("/auth/v1/settings");
  if (reach.status === 0) {
    add(SECTION_DB, fail(`Could not reach Supabase: ${reach.body.message}`));
  } else {
    add(SECTION_DB, pass("Supabase is reachable."));

    // every table the app needs, with a safe sample row used to prove Row Level Security is switched on
    const tables = [
      ["tasks", "id", { title: "preflight" }],
      ["user_ai_settings", "user_id", { provider: "openai", encrypted_key: "x" }],
      ["inbox_items", "id", { content: "preflight" }],
      ["commitments", "id", { description: "preflight" }],
      ["meetings", "id", { title: "preflight", transcript: "x" }],
      ["google_connections", "user_id", { encrypted_refresh_token: "x" }],
    ];
    for (const [table, col, sample] of tables) {
      const read = await call(`/rest/v1/${table}?select=${col}&limit=1`);
      if (read.status !== 200) {
        add(SECTION_DB, fail(`Table "${table}" is missing. Run supabase/schema.sql (or that milestone's SQL file) in the Supabase SQL Editor.`));
        continue;
      }
      // An anonymous insert must be refused by Row Level Security (42501). 23502 would mean RLS is OFF.
      const probe = await call(`/rest/v1/${table}`, { method: "POST", body: JSON.stringify(sample) });
      if (probe.body?.code === "42501") add(SECTION_DB, pass(`Table "${table}" exists and Row Level Security is on.`));
      else if (probe.status < 300) add(SECTION_DB, fail(`Table "${table}" ACCEPTED an anonymous write. Row Level Security is not protecting it!`));
      else add(SECTION_DB, fail(`Table "${table}": Row Level Security looks OFF (got ${probe.body?.code ?? probe.status} instead of 42501). Enable it and add the policies from supabase/schema.sql.`));
    }

    const fn = await call("/rest/v1/rpc/delete_my_account", { method: "POST", body: "{}" });
    if (fn.body?.code === "42501") add(SECTION_DB, pass("delete_my_account exists and anonymous visitors are refused."));
    else if (fn.status === 404) add(SECTION_DB, fail('Function "delete_my_account" is missing. Run supabase/milestone17-privacy.sql. Without it, "Delete my account" will not work.'));
    else add(SECTION_DB, fail(`delete_my_account answered an anonymous call with ${fn.status} (${fn.body?.code ?? "?"}). It must refuse anonymous callers.`));

    if (reach.body?.mailer_autoconfirm === true) {
      add(SECTION_DB, warn("Email confirmation is OFF, so anyone can sign up with any address, including one that is not theirs. Turn it on (Authentication → Sign In / Providers → Email → Confirm email) and set up SMTP before a public launch."));
    } else if (reach.body?.mailer_autoconfirm === false) {
      add(SECTION_DB, pass("Email confirmation is on."));
    }
    if (reach.body?.disable_signup === true) add(SECTION_DB, warn("New sign-ups are disabled in Supabase. Fine for a private app; users cannot register."));
  }
}

// ---------- git ----------
const SECTION_GIT = "Repository";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
try {
  const files = git("ls-files").split("\n").filter(Boolean);
  for (const r of checkTrackedFiles(files)) add(SECTION_GIT, r);

  const skip = /(^|\/)(package-lock\.json)$|\.(png|jpe?g|gif|ico|webp|woff2?|ttf|pdf|zip)$/i;
  const leaks = [];
  for (const f of files) {
    if (skip.test(f) || !existsSync(f) || statSync(f).size > 1_000_000) continue;
    for (const name of findSecrets(readFileSync(f, "utf8"))) leaks.push(`${f} (${name})`);
  }
  add(SECTION_GIT, leaks.length ? fail(`Secrets found in tracked files: ${leaks.join("; ")}. Remove them and ROTATE each one.`) : pass(`No secrets found in ${files.length} tracked files.`));

  // Past commits too: a secret deleted from today's code still lives in history.
  const revs = git("rev-list", "--all").split("\n").filter(Boolean);
  if (revs.length > 300) {
    add(SECTION_GIT, warn(`History has ${revs.length} commits; skipped the history scan. Run a tool like gitleaks.`));
  } else {
    let hits = "";
    try {
      hits = git("grep", "-I", "-l", "-E", "sb_secret_[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|BEGIN (RSA |EC )?PRIVATE KEY", ...revs);
    } catch {
      /* git grep exits 1 when nothing matches: that is the good outcome */
    }
    add(SECTION_GIT, hits.trim() ? fail("A secret-looking value exists in git history. Rotate it, and consider rewriting history.") : pass(`No secrets in the history (${revs.length} commits).`));
  }
} catch {
  add(SECTION_GIT, warn("Not a git repository (or git is not installed), so the repository checks were skipped."));
}

// ---------- report ----------
const icon = { pass: "PASS", warn: "WARN", fail: "FAIL" };
const color = { pass: "\x1b[32m", warn: "\x1b[33m", fail: "\x1b[31m" };
let section = "";
for (const r of results) {
  if (r.section !== section) {
    section = r.section;
    console.log(`\n${section}`);
  }
  console.log(`  ${color[r.level]}${icon[r.level]}\x1b[0m  ${r.message}`);
}
const count = (l) => results.filter((r) => r.level === l).length;
console.log(`\n${count("pass")} passed, ${count("warn")} warnings, ${count("fail")} failed.`);
if (count("fail")) {
  console.log("Fix the FAIL items before deploying.");
  process.exit(1);
}
console.log(count("warn") ? "No blockers. Read the warnings before a public launch." : "Ready to deploy.");
