import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const MAX_TEXT = 6000; // matches the limit the Inbox analysis uses

async function getSession() {
  const { session } = await chrome.storage.local.get("session");
  return session || null;
}

async function saveSession(t) {
  const session = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    // renew one minute early so a token never expires mid-request
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
    email: t.user?.email ?? "",
  };
  await chrome.storage.local.set({ session });
  return session;
}

async function tokenRequest(grantType, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grantType}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || "Login failed");
  return data;
}

export async function login(email, password) {
  return saveSession(await tokenRequest("password", { email, password }));
}

export async function logout() {
  await chrome.storage.local.remove("session");
}

export async function currentUser() {
  return (await getSession())?.email ?? null;
}

/** Returns a valid access token, refreshing it if needed. Returns null if the user must log in again. */
async function getValidToken() {
  const session = await getSession();
  if (!session) return null;
  if (Date.now() < session.expires_at) return session.access_token;
  try {
    const renewed = await saveSession(await tokenRequest("refresh_token", { refresh_token: session.refresh_token }));
    return renewed.access_token;
  } catch {
    await logout();
    return null;
  }
}

/** Saves text into the user's ActionBrain Inbox. Returns { ok: true } or { ok: false, error }. */
export async function sendToInbox(text, page = {}) {
  const content = (text || "").trim().slice(0, MAX_TEXT);
  if (!content) return { ok: false, error: "No text selected." };

  const token = await getValidToken();
  if (!token) return { ok: false, error: "Please log in: click the ActionBrain icon in the toolbar." };

  const label = [page.title, page.url].filter(Boolean).join(" — ").slice(0, 300) || null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/inbox_items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${token}`,
      prefer: "return=minimal",
    },
    body: JSON.stringify({ content, source_type: "browser", source_ref: label }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.message || `Could not save (${res.status}).` };
  }
  return { ok: true };
}
