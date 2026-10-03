// Microsoft Teams chats through Microsoft Graph (work or school accounts only). Server-side only: it uses the app's client secret.
//
// What it does: the user signs in with Microsoft ("Connect Microsoft Teams"), ActionBrain keeps an encrypted refresh token, and "Sync" reads
// the NEW messages of the chats the user is in (one-to-one, group and meeting chats) and files them in the Inbox. It needs only the
// delegated permission Chat.Read: ActionBrain sees what the signed-in user can already see, nothing more.
//
// Whether a person can sign in depends on their organisation: some let users approve the app themselves, others need an admin to approve it
// once for everyone. This file explains that to the user (friendlyAuthError) and builds the link to send an admin (buildAdminConsentUrl).
//
// Not covered here (needs an admin and different permissions): channel messages and meeting transcripts. See docs/microsoft-teams-setup.md.

export const SCOPES = ["openid", "profile", "offline_access", "User.Read", "Chat.Read"];
export const CHAT_SCOPE = "Chat.Read";

const MAX_CHATS = 15; // chats looked at per sync
const MAX_MESSAGES = 30; // newest messages read per chat per sync
const MAX_ITEMS = 100; // messages filed per sync
const MAX_TEXT = 1500;

export class MicrosoftError extends Error {
  constructor(
    message: string,
    public code: "NOT_CONNECTED" | "TOKEN_REVOKED" | "ADMIN_APPROVAL" | "RATE_LIMITED" | "FAILED"
  ) {
    super(message);
  }
}

import { friendlyAuthError, isTenantDomain } from "./microsoft-client.ts";

export { friendlyAuthError, isTenantDomain };

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function microsoftConfig(env: Env = process.env) {
  const id = env.MICROSOFT_CLIENT_ID;
  const secret = env.MICROSOFT_CLIENT_SECRET;
  // "organizations" = any work or school account. A company can pin its own directory with MICROSOFT_TENANT.
  const tenant = env.MICROSOFT_TENANT || "organizations";
  return id && secret ? { id, secret, tenant } : null;
}

/** Must match the "Redirect URI" in the Microsoft Entra app registration exactly. */
export function redirectUri(request: Request, env: Env = process.env) {
  return env.MICROSOFT_REDIRECT_URI || `${new URL(request.url).origin}/microsoft/callback`;
}

/**
 * Where an administrator lands after approving the app. A separate, PUBLIC page: the administrator usually has no ActionBrain account,
 * so it must not sit behind ActionBrain's login. Must also be registered as a Redirect URI in the Microsoft Entra app registration.
 */
export function adminRedirectUri(request: Request, env: Env = process.env) {
  return env.MICROSOFT_ADMIN_REDIRECT_URI || `${new URL(request.url).origin}/microsoft-approved`;
}

const authority = (tenant: string) => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;

export function buildAuthUrl(clientId: string, redirect: string, state: string, tenant = "organizations") {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirect,
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    prompt: "select_account", // people often have a personal and a work account: let them choose
  });
  return `${authority(tenant)}/oauth2/v2.0/authorize?${params}`;
}

/**
 * The link an organisation's admin opens once to approve ActionBrain for everyone in that organisation. It asks for exactly the permissions
 * the app is registered with (".default"), which is the list in docs/microsoft-teams-setup.md.
 */
export function buildAdminConsentUrl(clientId: string, redirect: string, domain: string, state = "admin-consent") {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "https://graph.microsoft.com/.default",
    redirect_uri: redirect,
    state,
  });
  return `${authority(domain)}/v2.0/adminconsent?${params}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(tenant: string, body: Record<string, string>, fetchImpl: FetchLike): Promise<TokenResponse> {
  const res = await fetchImpl(`${authority(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    const text = `${data.error ?? ""} ${data.error_description ?? ""}`;
    if (data.error === "invalid_grant" && !/AADSTS65001|AADSTS90094/.test(text)) {
      throw new MicrosoftError("Microsoft access has expired or was removed. Please reconnect.", "TOKEN_REVOKED");
    }
    if (/AADSTS(65001|90094|900941|90095)|consent_required/i.test(text)) {
      throw new MicrosoftError(friendlyAuthError(data.error ?? null, data.error_description ?? null).message, "ADMIN_APPROVAL");
    }
    // the description starts with a Microsoft error code and a trace id: keep only the first line, and never echo it back long
    throw new MicrosoftError((data.error_description || data.error || "Microsoft rejected the request.").split("\r\n")[0].slice(0, 200), "FAILED");
  }
  return data;
}

/** The part after the last "/" and lower-cased, so "https://graph.microsoft.com/Chat.Read" and "chat.read" both mean the same. */
export const normalizeScopes = (scope: string | undefined) => (scope ?? "").split(/\s+/).filter(Boolean).map((s) => s.split("/").pop()!.toLowerCase());

export type Identity = { userId: string | null; tenantId: string | null; account: string | null; name: string | null };

/** Reads who signed in from the id_token. It came straight from Microsoft over TLS in the code exchange, so it is only displayed and used to tell your own messages. */
export function identityFromIdToken(idToken?: string): Identity {
  try {
    const claims = JSON.parse(Buffer.from(idToken!.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 200) : null);
    return { userId: str(claims.oid), tenantId: str(claims.tid), account: str(claims.preferred_username) ?? str(claims.email) ?? str(claims.upn), name: str(claims.name) };
  } catch {
    return { userId: null, tenantId: null, account: null, name: null };
  }
}

export async function exchangeCode(code: string, redirect: string, fetchImpl: FetchLike = fetch, env: Env = process.env) {
  const cfg = microsoftConfig(env);
  if (!cfg) throw new MicrosoftError("Microsoft is not configured on this server.", "FAILED");
  const data = await tokenRequest(
    cfg.tenant,
    { code, client_id: cfg.id, client_secret: cfg.secret, redirect_uri: redirect, grant_type: "authorization_code", scope: SCOPES.join(" ") },
    fetchImpl
  );
  if (!data.refresh_token) throw new MicrosoftError("Microsoft did not return a refresh token. Try connecting again.", "FAILED");
  // People can often untick permissions on the consent screen, so check what was really granted.
  if (!normalizeScopes(data.scope).includes(CHAT_SCOPE.toLowerCase())) {
    throw new MicrosoftError("Chat access was not granted. Connect again and approve reading your chats.", "FAILED");
  }
  return { refreshToken: data.refresh_token, accessToken: data.access_token ?? null, scopes: normalizeScopes(data.scope), identity: identityFromIdToken(data.id_token) };
}

/** Microsoft may hand back a NEW refresh token each time. If it does, the caller must store it. */
export async function accessTokenFrom(refreshToken: string, fetchImpl: FetchLike = fetch, env: Env = process.env) {
  const cfg = microsoftConfig(env);
  if (!cfg) throw new MicrosoftError("Microsoft is not configured on this server.", "FAILED");
  const data = await tokenRequest(
    cfg.tenant,
    { refresh_token: refreshToken, client_id: cfg.id, client_secret: cfg.secret, grant_type: "refresh_token", scope: SCOPES.join(" ") },
    fetchImpl
  );
  if (!data.access_token) throw new MicrosoftError("Microsoft did not return an access token.", "FAILED");
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? refreshToken };
}

// ---------------- reading chats ----------------

export type GraphMember = { displayName?: string | null; userId?: string | null };
export type GraphChat = { id: string; chatType?: string; topic?: string | null; lastMessagePreview?: { createdDateTime?: string | null } | null; members?: GraphMember[] };
export type GraphMessage = {
  id?: string;
  messageType?: string;
  createdDateTime?: string;
  deletedDateTime?: string | null;
  from?: { user?: { id?: string | null; displayName?: string | null } | null } | null;
  body?: { contentType?: string; content?: string | null } | null;
};

/** One message, ready for the Inbox (the shape ingest_my_message takes). */
export type IngestItem = { source: "teams"; sender: string; text: string; group: string | null; mine: boolean; sentAt: string };

const GRAPH = "https://graph.microsoft.com/v1.0";

async function graphGet<T>(accessToken: string, url: string, fetchImpl: FetchLike): Promise<T> {
  const res = await fetchImpl(url.startsWith("http") ? url : `${GRAPH}${url}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  if (res.status === 401) throw new MicrosoftError("Microsoft no longer accepts the saved sign-in. Please reconnect.", "TOKEN_REVOKED");
  if (res.status === 403) {
    throw new MicrosoftError("Microsoft refused to share your chats. Your organisation may need to approve ActionBrain (see \"Ask your admin\").", "ADMIN_APPROVAL");
  }
  if (res.status === 429) throw new MicrosoftError("Microsoft asked ActionBrain to slow down. Try again in a minute.", "RATE_LIMITED");
  const code = body.error?.code;
  throw new MicrosoftError(`Microsoft Teams error ${res.status}${code ? ` (${code})` : ""}.`, "FAILED");
}

/** Your recent chats with their members. Asks for the last-message time too; if Microsoft refuses that combination, retries without it. */
export async function fetchChats(accessToken: string, fetchImpl: FetchLike = fetch): Promise<GraphChat[]> {
  let url = `/me/chats?$expand=members,lastMessagePreview&$top=50`;
  let page: { value?: GraphChat[]; "@odata.nextLink"?: string };
  try {
    page = await graphGet(accessToken, url, fetchImpl);
  } catch (e) {
    if (!(e instanceof MicrosoftError) || e.code !== "FAILED") throw e;
    url = `/me/chats?$expand=members&$top=50`;
    page = await graphGet(accessToken, url, fetchImpl);
  }
  const chats = [...(page.value ?? [])];
  for (let i = 0; i < 2 && page["@odata.nextLink"]; i++) {
    page = await graphGet(accessToken, page["@odata.nextLink"], fetchImpl);
    chats.push(...(page.value ?? []));
  }
  return chats;
}

export async function fetchMessages(accessToken: string, chatId: string, fetchImpl: FetchLike = fetch): Promise<GraphMessage[]> {
  const page = await graphGet<{ value?: GraphMessage[] }>(accessToken, `/chats/${encodeURIComponent(chatId)}/messages?$top=${MAX_MESSAGES}`, fetchImpl);
  return page.value ?? [];
}

// ---------------- turning chats into Inbox items ----------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Teams messages are HTML. This returns plain text: line breaks kept, @mentions as "@Name", attachments and pictures dropped. */
export function htmlToText(html: string): string {
  return html
    .replace(/<at[^>]*>([\s\S]*?)<\/at>/gi, (_, name: string) => `@${name.replace(/<[^>]*>/g, "").trim()}`)
    .replace(/<attachment[^>]*>[\s\S]*?<\/attachment>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
      if (ent[0] === "#") {
        const code = ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[ent.toLowerCase()] ?? whole;
    })
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** What the conversation is called: the other person (one-to-one), the group's name or its members (group), or the meeting. */
export function chatLabel(chat: GraphChat, myId: string | null): string {
  const topic = chat.topic?.trim();
  const others = (chat.members ?? []).filter((m) => m.userId !== myId && m.displayName?.trim()).map((m) => m.displayName!.trim());
  if (chat.chatType === "oneOnOne") return others[0] ?? "Teams chat";
  if (topic) return topic;
  if (chat.chatType === "meeting") return "Meeting chat";
  if (others.length === 0) return "Group chat";
  return others.slice(0, 3).join(", ") + (others.length > 3 ? "…" : "");
}

/** One Teams message as an Inbox item, or null for anything that is not a person's message (system notices, deleted messages, bots, empty text). */
export function messageToItem(chat: GraphChat, label: string, message: GraphMessage, myId: string | null): IngestItem | null {
  if (message.messageType !== "message" || message.deletedDateTime || !message.createdDateTime) return null;
  const user = message.from?.user;
  if (!user?.id) return null;
  const raw = message.body?.content ?? "";
  const text = (message.body?.contentType === "html" ? htmlToText(raw) : raw.trim()).slice(0, MAX_TEXT);
  if (!text) return null;

  const mine = !!myId && user.id === myId;
  const oneToOne = chat.chatType === "oneOnOne";
  return {
    source: "teams",
    // your own message: the "sender" is the chat it was written in (the same convention as the phone)
    sender: mine ? label : user.displayName?.trim() || "Unknown",
    text,
    group: oneToOne ? null : label,
    mine,
    sentAt: message.createdDateTime,
  };
}

const time = (iso?: string | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

export type SyncPlan = { items: IngestItem[]; newest: string | null; chatsChecked: number };

/**
 * Finds the messages newer than `since` in the user's most recently active chats, oldest first (so the Inbox reads in order).
 * `newest` is the time of the newest message SEEN (even if it was a system notice), so the next sync starts after it.
 */
export async function planSync(
  chats: GraphChat[],
  since: string,
  myId: string | null,
  getMessages: (chatId: string) => Promise<GraphMessage[]>
): Promise<SyncPlan> {
  const cutoff = time(since);
  // chats with a preview older than the cutoff have nothing new; chats with no preview time are checked to be safe
  const active = chats
    .filter((c) => !c.lastMessagePreview?.createdDateTime || time(c.lastMessagePreview.createdDateTime) > cutoff)
    .sort((a, b) => time(b.lastMessagePreview?.createdDateTime) - time(a.lastMessagePreview?.createdDateTime))
    .slice(0, MAX_CHATS);

  const items: IngestItem[] = [];
  let newest = 0;
  for (const chat of active) {
    const label = chatLabel(chat, myId);
    for (const message of await getMessages(chat.id)) {
      const at = time(message.createdDateTime);
      if (at <= cutoff) continue;
      newest = Math.max(newest, at);
      const item = messageToItem(chat, label, message, myId);
      if (item) items.push(item);
    }
  }
  items.sort((a, b) => time(a.sentAt) - time(b.sentAt));
  return { items: items.slice(-MAX_ITEMS), newest: newest ? new Date(newest).toISOString() : null, chatsChecked: active.length };
}

export async function syncTeams(accessToken: string, since: string, myId: string | null, fetchImpl: FetchLike = fetch): Promise<SyncPlan> {
  const chats = await fetchChats(accessToken, fetchImpl);
  return planSync(chats, since, myId, (id) => fetchMessages(accessToken, id, fetchImpl));
}

/** The signed-in user's id, for tokens that did not carry it. Needed to tell your own messages from others'. */
export async function fetchMyId(accessToken: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const me = await graphGet<{ id?: string }>(accessToken, "/me?$select=id", fetchImpl);
  return typeof me.id === "string" ? me.id : null;
}
