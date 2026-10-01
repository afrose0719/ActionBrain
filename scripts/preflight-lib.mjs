// Pure checking logic for `npm run preflight`. No network, no files, so it can be unit-tested.
// Each check returns { level: "pass" | "warn" | "fail", message }.

const pass = (message) => ({ level: "pass", message });
const warn = (message) => ({ level: "warn", message });
const fail = (message) => ({ level: "fail", message });

function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).role ?? null;
  } catch {
    return null;
  }
}

/**
 * The browser-facing Supabase key MUST be the public one. A secret/service_role key here would be sent to every
 * visitor's browser and would bypass all Row Level Security. This is the most dangerous deployment mistake.
 */
export function classifySupabaseKey(key) {
  if (!key) return { kind: "missing" };
  if (key.startsWith("sb_publishable_")) return { kind: "public" };
  if (key.startsWith("sb_secret_")) return { kind: "secret" };
  if (key.startsWith("eyJ")) {
    const role = jwtRole(key);
    if (role === "anon") return { kind: "public" };
    if (role === "service_role") return { kind: "secret" };
  }
  return { kind: "unknown" };
}

export function checkSupabaseUrl(url) {
  if (!url) return fail("NEXT_PUBLIC_SUPABASE_URL is not set.");
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return fail("NEXT_PUBLIC_SUPABASE_URL must start with https://");
    if (!u.hostname.endsWith(".supabase.co")) return warn(`NEXT_PUBLIC_SUPABASE_URL is ${u.hostname}, not a *.supabase.co address. Fine for a self-hosted Supabase, otherwise check it.`);
    if (u.pathname !== "/" && u.pathname !== "") return warn("NEXT_PUBLIC_SUPABASE_URL should be just the project address, with nothing after the domain.");
    return pass(`Supabase URL looks right (${u.hostname}).`);
  } catch {
    return fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
}

export function checkSupabaseKey(key) {
  const { kind } = classifySupabaseKey(key);
  if (kind === "missing") return fail("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.");
  if (kind === "secret") {
    return fail(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY holds a SECRET / service_role key. Anything named NEXT_PUBLIC_ is sent to every visitor's browser and this key bypasses all data protection. Replace it with the publishable key and ROTATE the secret one in Supabase."
    );
  }
  if (kind === "unknown") return warn("NEXT_PUBLIC_SUPABASE_ANON_KEY does not look like a Supabase publishable (sb_publishable_...) or anon key. Double-check it.");
  return pass("Supabase key is the public (publishable/anon) kind.");
}

export function checkEncryptionKey(value) {
  if (!value) return fail("AI_KEY_ENCRYPTION_KEY is not set. Users could not save AI keys.");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) {
    return fail(`AI_KEY_ENCRYPTION_KEY must be 32 random bytes in base64 (yours decodes to ${bytes.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`);
  }
  return pass("AI_KEY_ENCRYPTION_KEY is a valid 32-byte key.");
}

export function checkGoogle(env) {
  const id = !!env.GOOGLE_CLIENT_ID;
  const secret = !!env.GOOGLE_CLIENT_SECRET;
  if (id && secret) return pass("Google Calendar is configured.");
  if (!id && !secret) return warn("Google Calendar is not configured. That is fine if you do not need it.");
  return fail("Only one of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET is set. Set both, or neither.");
}

// ---------------- secret scanner ----------------

const SECRET_PATTERNS = [
  { name: "Supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{16,}/ },
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Google OAuth client secret", re: /GOCSPX-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

/** Looks through one file's text. Returns the names of any secrets found (never the secret itself). */
export function findSecrets(text) {
  const found = SECRET_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
  // a JWT is only a secret when its role is service_role; the public anon/publishable keys are meant to be shipped
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    if (jwtRole(m[0]) === "service_role") found.push("Supabase service_role key");
  }
  return [...new Set(found)];
}

export function checkTrackedFiles(files) {
  const results = [];
  const envFiles = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"));
  results.push(envFiles.length ? fail(`Environment file(s) are tracked by git: ${envFiles.join(", ")}. Remove them from git (git rm --cached) and rotate every secret inside.`) : pass("No .env files are tracked by git."));
  return results;
}
