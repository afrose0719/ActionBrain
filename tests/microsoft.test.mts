import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  MicrosoftError,
  accessTokenFrom,
  adminRedirectUri,
  buildAdminConsentUrl,
  buildAuthUrl,
  chatLabel,
  exchangeCode,
  fetchChats,
  fetchMessages,
  fetchMyId,
  htmlToText,
  identityFromIdToken,
  messageToItem,
  microsoftConfig,
  normalizeScopes,
  planSync,
  redirectUri,
  syncTeams,
  type GraphChat,
  type GraphMessage,
} from "../src/lib/microsoft.ts";
import { friendlyAuthError, isTenantDomain } from "../src/lib/microsoft-client.ts";

const ENV = { MICROSOFT_CLIENT_ID: "client-id-123", MICROSOFT_CLIENT_SECRET: "client-secret-456" };
const ME = "me-111";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const jwt = (claims: unknown) => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

type Call = { url: string; init?: RequestInit };
/** A pretend Microsoft: answers by matching the start of the URL, and records every call. */
function fakeMicrosoft(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected request: ${url}`);
    return routes[key]({ url, init });
  };
  return { fetchImpl, calls };
}

// ---------------- configuration ----------------
test("Microsoft is configured only when both the id and the secret are set", () => {
  assert.equal(microsoftConfig({}), null);
  assert.equal(microsoftConfig({ MICROSOFT_CLIENT_ID: "a" }), null);
  assert.equal(microsoftConfig({ MICROSOFT_CLIENT_SECRET: "b" }), null);
  assert.deepEqual(microsoftConfig(ENV), { id: "client-id-123", secret: "client-secret-456", tenant: "organizations" });
  assert.equal(microsoftConfig({ ...ENV, MICROSOFT_TENANT: "contoso.com" })?.tenant, "contoso.com");
});

test("the redirect addresses default to this site and can be overridden", () => {
  const request = new Request("https://action-brain.example/api/microsoft/connect?state=x");
  assert.equal(redirectUri(request, {}), "https://action-brain.example/microsoft/callback");
  assert.equal(adminRedirectUri(request, {}), "https://action-brain.example/microsoft-approved");
  assert.equal(redirectUri(request, { MICROSOFT_REDIRECT_URI: "https://other.example/cb" }), "https://other.example/cb");
  assert.equal(adminRedirectUri(request, { MICROSOFT_ADMIN_REDIRECT_URI: "https://other.example/ok" }), "https://other.example/ok");
});

// ---------------- the sign-in link ----------------
test("the sign-in link asks for exactly the chat permission and never contains the secret", () => {
  const url = new URL(buildAuthUrl("client-id-123", "https://x.example/microsoft/callback", "state-abc-123456789012"));
  assert.equal(url.origin + url.pathname, "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
  assert.equal(url.searchParams.get("client_id"), "client-id-123");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://x.example/microsoft/callback");
  assert.equal(url.searchParams.get("state"), "state-abc-123456789012");
  assert.deepEqual(url.searchParams.get("scope")?.split(" ").sort(), ["Chat.Read", "User.Read", "offline_access", "openid", "profile"]);
  assert.ok(!url.toString().includes("secret"));
});

test("only the Chat.Read data permission is asked for: no write, no channels, no meetings, no mail", () => {
  const scope = new URL(buildAuthUrl("c", "https://x.example/cb", "s")).searchParams.get("scope") ?? "";
  for (const forbidden of ["ReadWrite", "Send", "ChannelMessage", "OnlineMeeting", "Mail", "Files", "Calendars", ".All"]) assert.ok(!scope.includes(forbidden), forbidden);
});

test("a company can pin its own directory in the sign-in link", () => {
  assert.ok(buildAuthUrl("c", "https://x.example/cb", "s", "contoso.com").startsWith("https://login.microsoftonline.com/contoso.com/oauth2/v2.0/authorize?"));
});

// ---------------- the link for an administrator ----------------
test("only a plain company domain is accepted for the admin link", () => {
  for (const ok of ["contoso.com", "quadrobay.com", "mail.example.co.uk", "a-b.example.org", "CONTOSO.COM"]) assert.equal(isTenantDomain(ok), true, ok);
  for (const bad of ["", "localhost", "contoso", "contoso.com/evil", "contoso.com?x=1", "a b.com", "-bad.com", "bad-.com", "evil.com#frag", "https://contoso.com", "x@contoso.com", "contoso.com\n", "a".repeat(300) + ".com", null, 5, undefined]) {
    assert.equal(isTenantDomain(bad), false, String(bad));
  }
});

test("the admin link names the app and the permission list, and points back to the public approval page", () => {
  const url = new URL(buildAdminConsentUrl("client-id-123", "https://x.example/microsoft-approved", "contoso.com"));
  assert.equal(url.origin + url.pathname, "https://login.microsoftonline.com/contoso.com/v2.0/adminconsent");
  assert.equal(url.searchParams.get("client_id"), "client-id-123");
  assert.equal(url.searchParams.get("scope"), "https://graph.microsoft.com/.default");
  assert.equal(url.searchParams.get("redirect_uri"), "https://x.example/microsoft-approved");
  assert.ok(!url.toString().includes("secret"));
});

// ---------------- what to tell people ----------------
test("consent problems tell the person to ask their administrator", () => {
  for (const [error, description] of [
    ["access_denied", "AADSTS65001: The user or administrator has not consented to use the application"],
    ["invalid_request", "AADSTS90094: The grant requires admin permission"],
    ["consent_required", null],
    [null, "Need admin approval"],
  ] as const) {
    const r = friendlyAuthError(error, description);
    assert.equal(r.adminNeeded, true, `${error} ${description}`);
    assert.match(r.message, /administrator/);
  }
});

test("cancelling, a personal account and anything else each get their own plain message", () => {
  assert.equal(friendlyAuthError("access_denied", "AADSTS65004: user declined").adminNeeded, false);
  assert.match(friendlyAuthError("access_denied", "AADSTS65004").message, /cancelled/);
  assert.match(friendlyAuthError("invalid_request", "AADSTS50020: personal account not allowed").message, /work or school/);
  assert.match(friendlyAuthError("server_error", "something else").message, /Microsoft returned an error/);
  assert.match(friendlyAuthError(null, null).message, /Microsoft returned an error/);
});

// ---------------- reading the sign-in result ----------------
test("granted permissions are compared by name, whatever form Microsoft writes them in", () => {
  assert.deepEqual(normalizeScopes("https://graph.microsoft.com/Chat.Read User.Read openid"), ["chat.read", "user.read", "openid"]);
  assert.deepEqual(normalizeScopes("  CHAT.READ   profile "), ["chat.read", "profile"]);
  assert.deepEqual(normalizeScopes(undefined), []);
});

test("who signed in is read from the id token, and a damaged token gives nothing", () => {
  const id = identityFromIdToken(jwt({ oid: "oid-1", tid: "tid-1", preferred_username: "afrose@quadrobay.com", name: "Afrose A" }));
  assert.deepEqual(id, { userId: "oid-1", tenantId: "tid-1", account: "afrose@quadrobay.com", name: "Afrose A" });
  assert.equal(identityFromIdToken(jwt({ email: "e@x.com" })).account, "e@x.com");
  assert.deepEqual(identityFromIdToken("garbage"), { userId: null, tenantId: null, account: null, name: null });
  assert.deepEqual(identityFromIdToken(undefined), { userId: null, tenantId: null, account: null, name: null });
  assert.equal(identityFromIdToken(jwt({ preferred_username: "x".repeat(500) })).account?.length, 200);
  assert.equal(identityFromIdToken(jwt({ oid: 123 })).userId, null);
});

// ---------------- exchanging the code ----------------
const goodToken = {
  access_token: "access-1",
  refresh_token: "refresh-1",
  scope: "https://graph.microsoft.com/Chat.Read https://graph.microsoft.com/User.Read openid profile",
  id_token: jwt({ oid: "oid-1", tid: "tid-1", preferred_username: "afrose@quadrobay.com" }),
};

test("exchanging the code sends the secret in the BODY (never the URL) and returns the refresh token and who signed in", async () => {
  const ms = fakeMicrosoft({ "/oauth2/v2.0/token": () => json(goodToken) });
  const r = await exchangeCode("the-code", "https://x.example/microsoft/callback", ms.fetchImpl, ENV);
  assert.equal(r.refreshToken, "refresh-1");
  assert.equal(r.identity.account, "afrose@quadrobay.com");
  assert.ok(r.scopes.includes("chat.read"));
  const { url, init } = ms.calls[0];
  assert.equal(url, "https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
  assert.ok(!url.includes("client-secret-456") && !url.includes("the-code"));
  const body = new URLSearchParams(String(init?.body));
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code"), "the-code");
  assert.equal(body.get("client_secret"), "client-secret-456");
  assert.equal(body.get("redirect_uri"), "https://x.example/microsoft/callback");
});

test("signing in fails clearly when the server is not configured, there is no refresh token, or chat access was unticked", async () => {
  await assert.rejects(exchangeCode("c", "r", fakeMicrosoft({}).fetchImpl, {}), /not configured/);
  const noRefresh = fakeMicrosoft({ "/token": () => json({ ...goodToken, refresh_token: undefined }) });
  await assert.rejects(exchangeCode("c", "r", noRefresh.fetchImpl, ENV), /refresh token/);
  const noChat = fakeMicrosoft({ "/token": () => json({ ...goodToken, scope: "openid profile User.Read" }) });
  await assert.rejects(exchangeCode("c", "r", noChat.fetchImpl, ENV), /Chat access was not granted/);
});

test("Microsoft's errors become the right kind of error", async () => {
  const consent = fakeMicrosoft({ "/token": () => json({ error: "invalid_grant", error_description: "AADSTS65001: The user has not consented" }, 400) });
  await assert.rejects(exchangeCode("c", "r", consent.fetchImpl, ENV), (e: unknown) => e instanceof MicrosoftError && e.code === "ADMIN_APPROVAL");
  const revoked = fakeMicrosoft({ "/token": () => json({ error: "invalid_grant", error_description: "AADSTS70008: expired" }, 400) });
  await assert.rejects(accessTokenFrom("old", revoked.fetchImpl, ENV), (e: unknown) => e instanceof MicrosoftError && e.code === "TOKEN_REVOKED");
  const long = fakeMicrosoft({ "/token": () => json({ error: "server_error", error_description: `AADSTS1: first line\r\nTrace ID: secret-trace\r\n${"x".repeat(900)}` }, 500) });
  await assert.rejects(accessTokenFrom("t", long.fetchImpl, ENV), (e: unknown) => e instanceof MicrosoftError && e.code === "FAILED" && !e.message.includes("secret-trace") && e.message.length <= 200);
});

test("a refresh returns the new refresh token when Microsoft rotates it, and the old one when it does not", async () => {
  const rotated = fakeMicrosoft({ "/token": () => json({ access_token: "a2", refresh_token: "r2" }) });
  assert.deepEqual(await accessTokenFrom("r1", rotated.fetchImpl, ENV), { accessToken: "a2", refreshToken: "r2" });
  const same = fakeMicrosoft({ "/token": () => json({ access_token: "a3" }) });
  assert.deepEqual(await accessTokenFrom("r1", same.fetchImpl, ENV), { accessToken: "a3", refreshToken: "r1" });
  const none = fakeMicrosoft({ "/token": () => json({}) });
  await assert.rejects(accessTokenFrom("r1", none.fetchImpl, ENV), /access token/);
  assert.equal(new URLSearchParams(String(rotated.calls[0].init?.body)).get("grant_type"), "refresh_token");
});

// ---------------- talking to Teams ----------------
test("Teams' answers are turned into clear errors", async () => {
  for (const [status, code] of [[401, "TOKEN_REVOKED"], [403, "ADMIN_APPROVAL"], [429, "RATE_LIMITED"], [500, "FAILED"]] as const) {
    const ms = fakeMicrosoft({ "/me": () => json({ error: { code: "Boom", message: "do not echo me" } }, status) });
    await assert.rejects(fetchMyId("token", ms.fetchImpl), (e: unknown) => e instanceof MicrosoftError && e.code === code && !e.message.includes("do not echo me"), String(status));
  }
});

test("the access token goes in the Authorization header, never the URL", async () => {
  const ms = fakeMicrosoft({ "/me": () => json({ id: ME }) });
  assert.equal(await fetchMyId("tok-123", ms.fetchImpl), ME);
  assert.equal((ms.calls[0].init?.headers as Record<string, string>).authorization, "Bearer tok-123");
  assert.ok(!ms.calls[0].url.includes("tok-123"));
});

test("chats are listed with their members, retrying without the preview if Microsoft refuses that combination", async () => {
  let n = 0;
  const ms = fakeMicrosoft({
    "/me/chats": (call) => (call.url.includes("lastMessagePreview") && n++ === 0 ? json({ error: { code: "BadRequest" } }, 400) : json({ value: [{ id: "c1" }] })),
  });
  assert.deepEqual(await fetchChats("t", ms.fetchImpl), [{ id: "c1" }]);
  assert.equal(ms.calls.length, 2);
  assert.ok(ms.calls[0].url.includes("$expand=members,lastMessagePreview"));
  assert.ok(!ms.calls[1].url.includes("lastMessagePreview"));
});

test("a refusal (403) or rate limit is not retried as if it were a bad request", async () => {
  for (const status of [403, 429, 401]) {
    const ms = fakeMicrosoft({ "/me/chats": () => json({}, status) });
    await assert.rejects(fetchChats("t", ms.fetchImpl));
    assert.equal(ms.calls.length, 1, String(status));
  }
});

test("chat lists follow the next-page link, but only for two more pages", async () => {
  let page = 0;
  const ms = fakeMicrosoft({
    "/me/chats": () => json({ value: [{ id: `p${page}` }], "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/chats?page=${++page}` }),
    "page=": () => json({ value: [{ id: `p${page}` }], "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/chats?page=${++page}` }),
  });
  const chats = await fetchChats("t", ms.fetchImpl);
  assert.equal(chats.length, 3);
  assert.equal(ms.calls.length, 3);
});

test("a chat's messages are fetched for that chat id only, encoded", async () => {
  const ms = fakeMicrosoft({ "/chats/": () => json({ value: [{ id: "m1" }] }) });
  assert.deepEqual(await fetchMessages("t", "19:abc@thread.v2", ms.fetchImpl), [{ id: "m1" }]);
  assert.ok(ms.calls[0].url.includes("/chats/19%3Aabc%40thread.v2/messages"));
});

// ---------------- turning Teams HTML into text ----------------
test("Teams HTML becomes plain text with line breaks, mentions and no attachments", () => {
  assert.equal(htmlToText("<p>Hello <b>there</b></p><p>Second line</p>"), "Hello there\nSecond line");
  assert.equal(htmlToText("one<br>two<br/>three"), "one\ntwo\nthree");
  assert.equal(htmlToText('<p><at id="0">Rajesh Kumar</at> can you send the RCA?</p>'), "@Rajesh Kumar can you send the RCA?");
  assert.equal(htmlToText('<p>See file</p><attachment id="abc"></attachment>'), "See file");
  assert.equal(htmlToText('<img src="https://x/y.png" alt="photo">'), "");
  assert.equal(htmlToText(""), "");
});

test("HTML entities are decoded, including numeric ones, and bad ones are harmless", () => {
  assert.equal(htmlToText("Tom &amp; Jerry &lt;3 &quot;ok&quot; &#39;x&#39; &nbsp;y"), `Tom & Jerry <3 "ok" 'x' y`);
  assert.equal(htmlToText("smile &#x1F600; &#128512;"), "smile 😀 😀");
  assert.equal(htmlToText("bad &#0; &#99999999; &unknownentity; end"), "bad &unknownentity; end".replace("bad ", "bad  ").replace(/ {2,}/g, " "));
});

test("markup in a message can never become markup: tags are removed and what is left is only text", () => {
  const out = htmlToText('<script>alert("x")</script><a href="javascript:evil()">link</a><div onclick="x()">hi</div>');
  assert.ok(!/[<>]/.test(out), out);
  assert.ok(out.includes("link") && out.includes("hi"));
});

// ---------------- naming the conversation ----------------
const member = (userId: string, displayName: string) => ({ userId, displayName });

test("a one-to-one chat is named after the other person", () => {
  assert.equal(chatLabel({ id: "c", chatType: "oneOnOne", members: [member(ME, "Me Myself"), member("r1", "Rajesh")] }, ME), "Rajesh");
  assert.equal(chatLabel({ id: "c", chatType: "oneOnOne", members: [member(ME, "Me")] }, ME), "Teams chat");
});

test("a group chat uses its name, else its first three other members, a meeting chat its title", () => {
  assert.equal(chatLabel({ id: "c", chatType: "group", topic: " Sprint chat ", members: [] }, ME), "Sprint chat");
  const members = [member(ME, "Me"), member("a", "Asha"), member("b", "Lee"), member("c", "Maya"), member("d", "Omar")];
  assert.equal(chatLabel({ id: "c", chatType: "group", members }, ME), "Asha, Lee, Maya…");
  assert.equal(chatLabel({ id: "c", chatType: "group", members: members.slice(0, 3) }, ME), "Asha, Lee");
  assert.equal(chatLabel({ id: "c", chatType: "group", members: [member(ME, "Me")] }, ME), "Group chat");
  assert.equal(chatLabel({ id: "c", chatType: "meeting", topic: "Weekly sync" }, ME), "Weekly sync");
  assert.equal(chatLabel({ id: "c", chatType: "meeting" }, ME), "Meeting chat");
  assert.equal(chatLabel({ id: "c" }, ME), "Group chat");
});

// ---------------- messages ----------------
const oneOnOne: GraphChat = { id: "c1", chatType: "oneOnOne", members: [member(ME, "Me"), member("r1", "Rajesh")] };
const group: GraphChat = { id: "c2", chatType: "group", topic: "Sprint chat", members: [member(ME, "Me"), member("r1", "Rajesh")] };
const msg = (over: Partial<GraphMessage> & { text?: string; html?: string } = {}): GraphMessage => ({
  id: "m",
  messageType: "message",
  createdDateTime: "2026-10-03T10:00:00.000Z",
  from: { user: { id: "r1", displayName: "Rajesh" } },
  body: over.html !== undefined ? { contentType: "html", content: over.html } : { contentType: "text", content: over.text ?? "Can you send the RCA by Friday?" },
  ...over,
});

test("a message from someone else in a one-to-one chat", () => {
  assert.deepEqual(messageToItem(oneOnOne, "Rajesh", msg(), ME), {
    source: "teams",
    sender: "Rajesh",
    text: "Can you send the RCA by Friday?",
    group: null,
    mine: false,
    sentAt: "2026-10-03T10:00:00.000Z",
  });
});

test("your own message names the CHAT as sender (the same convention as the phone) and is marked mine", () => {
  const item = messageToItem(oneOnOne, "Rajesh", msg({ from: { user: { id: ME, displayName: "Me" } }, text: "I will send it tomorrow" }), ME);
  assert.equal(item?.mine, true);
  assert.equal(item?.sender, "Rajesh");
  assert.equal(item?.group, null);
  const inGroup = messageToItem(group, "Sprint chat", msg({ from: { user: { id: ME, displayName: "Me" } }, text: "On it" }), ME);
  assert.deepEqual([inGroup?.mine, inGroup?.sender, inGroup?.group], [true, "Sprint chat", "Sprint chat"]);
});

test("a group message carries the member's name and the group", () => {
  const item = messageToItem(group, "Sprint chat", msg({ text: "Please review the PR" }), ME);
  assert.deepEqual([item?.sender, item?.group, item?.mine], ["Rajesh", "Sprint chat", false]);
});

test("HTML messages become text, and over-long text is cut", () => {
  assert.equal(messageToItem(oneOnOne, "Rajesh", msg({ html: "<p>Hi <at id=\"0\">Me</at></p>" }), ME)?.text, "Hi @Me");
  assert.equal(messageToItem(oneOnOne, "Rajesh", msg({ text: "w".repeat(5000) }), ME)?.text.length, 1500);
});

test("system notices, deleted messages, bots, strangers without an id and empty messages are not kept", () => {
  assert.equal(messageToItem(oneOnOne, "R", msg({ messageType: "systemEventMessage" }), ME), null);
  assert.equal(messageToItem(oneOnOne, "R", msg({ messageType: "unknownFutureValue" }), ME), null);
  assert.equal(messageToItem(oneOnOne, "R", msg({ deletedDateTime: "2026-10-03T11:00:00Z" }), ME), null);
  assert.equal(messageToItem(oneOnOne, "R", msg({ from: null }), ME), null);
  assert.equal(messageToItem(oneOnOne, "R", msg({ from: { user: null } }), ME), null);
  assert.equal(messageToItem(oneOnOne, "R", msg({ from: { user: { displayName: "No id" } } }), ME), null);
  assert.equal(messageToItem(oneOnOne, "R", msg({ text: "   " }), ME), null);
  assert.equal(messageToItem(oneOnOne, "R", msg({ html: '<attachment id="x"></attachment>' }), ME), null);
  assert.equal(messageToItem(oneOnOne, "R", msg({ createdDateTime: undefined }), ME), null);
});

test("with no known user id, no message is ever treated as yours", () => {
  assert.equal(messageToItem(oneOnOne, "Rajesh", msg({ from: { user: { id: ME, displayName: "Me" } } }), null)?.mine, false);
});

test("a sender with no name is 'Unknown'", () => {
  assert.equal(messageToItem(oneOnOne, "R", msg({ from: { user: { id: "r1", displayName: "  " } } }), ME)?.sender, "Unknown");
});

// ---------------- planning a sync ----------------
const preview = (iso: string) => ({ createdDateTime: iso });
const at = (iso: string, extra: Partial<GraphMessage> = {}) => msg({ createdDateTime: iso, text: `at ${iso}`, ...extra });

test("only messages after the cutoff are returned, oldest first, across chats", async () => {
  const chats: GraphChat[] = [
    { ...oneOnOne, lastMessagePreview: preview("2026-10-03T10:30:00Z") },
    { ...group, lastMessagePreview: preview("2026-10-03T10:20:00Z") },
  ];
  const messages: Record<string, GraphMessage[]> = {
    c1: [at("2026-10-03T10:30:00Z"), at("2026-10-03T10:10:00Z"), at("2026-10-03T09:00:00Z")], // newest first, as Teams returns them
    c2: [at("2026-10-03T10:20:00Z"), at("2026-10-03T08:00:00Z")],
  };
  const plan = await planSync(chats, "2026-10-03T09:30:00Z", ME, async (id) => messages[id]);
  assert.deepEqual(plan.items.map((i) => i.sentAt), ["2026-10-03T10:10:00Z", "2026-10-03T10:20:00Z", "2026-10-03T10:30:00Z"]);
  assert.equal(plan.newest, "2026-10-03T10:30:00.000Z");
  assert.equal(plan.chatsChecked, 2);
});

test("a message at exactly the cutoff is not imported twice, even in a chat that has newer messages", async () => {
  // the chat is active (its newest message is after the cutoff), so its messages ARE read: the rule under test is the per-message one
  const chats: GraphChat[] = [{ ...oneOnOne, lastMessagePreview: preview("2026-10-03T10:05:00Z") }];
  const plan = await planSync(chats, "2026-10-03T10:00:00Z", ME, async () => [at("2026-10-03T10:05:00Z"), at("2026-10-03T10:00:00Z"), at("2026-10-03T09:59:00Z")]);
  assert.deepEqual(plan.items.map((i) => i.sentAt), ["2026-10-03T10:05:00Z"]);
  assert.equal(plan.newest, "2026-10-03T10:05:00.000Z");
});

test("a chat whose newest message is exactly the cutoff is not opened at all", async () => {
  const opened: string[] = [];
  const plan = await planSync([{ ...oneOnOne, lastMessagePreview: preview("2026-10-03T10:00:00Z") }], "2026-10-03T10:00:00Z", ME, async (id) => (opened.push(id), [at("2026-10-03T10:00:00Z")]));
  assert.deepEqual(opened, []);
  assert.deepEqual(plan.items, []);
});

test("chats with nothing newer than the cutoff are not even opened", async () => {
  const opened: string[] = [];
  const chats: GraphChat[] = [
    { ...oneOnOne, id: "old", lastMessagePreview: preview("2026-10-01T10:00:00Z") },
    { ...oneOnOne, id: "new", lastMessagePreview: preview("2026-10-03T10:00:00Z") },
    { ...oneOnOne, id: "unknown" }, // no preview time: checked to be safe
  ];
  const plan = await planSync(chats, "2026-10-02T00:00:00Z", ME, async (id) => (opened.push(id), []));
  assert.deepEqual(opened.sort(), ["new", "unknown"]);
  assert.equal(plan.chatsChecked, 2);
});

test("the newest message seen counts even if it was a system notice, so the next sync starts after it", async () => {
  const plan = await planSync(
    [{ ...oneOnOne, lastMessagePreview: preview("2026-10-03T12:00:00Z") }],
    "2026-10-03T09:00:00Z",
    ME,
    async () => [at("2026-10-03T12:00:00Z", { messageType: "systemEventMessage" }), at("2026-10-03T10:00:00Z")]
  );
  assert.equal(plan.items.length, 1);
  assert.equal(plan.newest, "2026-10-03T12:00:00.000Z");
});

test("nothing new gives no newest time, so the saved marker is left alone", async () => {
  const plan = await planSync([{ ...oneOnOne, lastMessagePreview: preview("2026-10-03T10:00:00Z") }], "2026-10-03T11:00:00Z", ME, async () => []);
  assert.equal(plan.newest, null);
  assert.equal(plan.chatsChecked, 0);
});

test("a sync looks at no more than 15 chats and keeps no more than 100 messages (the newest 100)", async () => {
  const chats: GraphChat[] = Array.from({ length: 40 }, (_, i) => ({ ...oneOnOne, id: `c${i}`, lastMessagePreview: preview(`2026-10-03T10:${String(i).padStart(2, "0")}:00Z`) }));
  const opened: string[] = [];
  const generated: string[] = [];
  const plan = await planSync(chats, "2026-10-03T00:00:00Z", ME, async (id) => {
    opened.push(id);
    return Array.from({ length: 30 }, (_, k) => {
      const when = `2026-10-03T11:${String(k).padStart(2, "0")}:${String(Number(id.slice(1)) % 60).padStart(2, "0")}Z`;
      generated.push(when);
      return at(when);
    });
  });
  assert.equal(opened.length, 15);
  assert.ok(opened.includes("c39") && !opened.includes("c0"), "the most recently active chats are the ones read");
  assert.equal(plan.items.length, 100);
  const newest100 = [...generated].sort((a, b) => Date.parse(a) - Date.parse(b)).slice(-100);
  assert.deepEqual(plan.items.map((i) => i.sentAt), newest100, "the kept messages are the NEWEST 100, in time order");
});

test("an error reading one chat stops the sync (so the marker never skips messages)", async () => {
  await assert.rejects(planSync([{ ...oneOnOne, lastMessagePreview: preview("2026-10-03T10:00:00Z") }], "2026-10-03T09:00:00Z", ME, async () => Promise.reject(new MicrosoftError("slow down", "RATE_LIMITED"))), /slow down/);
});

test("the whole sync, against a pretend Teams", async () => {
  const ms = fakeMicrosoft({
    "/me/chats": () => json({ value: [{ ...oneOnOne, lastMessagePreview: preview("2026-10-03T10:30:00Z") }] }),
    "/chats/c1/messages": () =>
      json({
        value: [
          { ...at("2026-10-03T10:30:00Z", { from: { user: { id: ME, displayName: "Me" } } }), body: { contentType: "html", content: "<p>I will send it tomorrow</p>" } },
          at("2026-10-03T10:10:00Z"),
        ],
      }),
  });
  const plan = await syncTeams("token", "2026-10-03T09:00:00Z", ME, ms.fetchImpl);
  assert.deepEqual(plan.items.map((i) => [i.sender, i.mine, i.text]), [["Rajesh", false, "at 2026-10-03T10:10:00Z"], ["Rajesh", true, "I will send it tomorrow"]]);
});

// ---------------- the code around it ----------------
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the Microsoft routes never use a service-role key and never log tokens", () => {
  for (const file of ["connect", "status", "sync", "admin-link"]) {
    const src = read(`src/app/api/microsoft/${file}/route.ts`);
    assert.ok(!/service_role|SERVICE_ROLE/.test(src), file);
    assert.ok(!/console\.(log|error|warn)/.test(src), file);
    assert.ok(src.includes("getUserClient(request)"), `${file} must check who is calling`);
  }
  assert.ok(!/console\./.test(read("src/lib/microsoft.ts")));
});

test("the refresh token is stored encrypted, and the sign-in starts a clean history", () => {
  const connect = read("src/app/api/microsoft/connect/route.ts");
  assert.ok(connect.includes("encrypted_refresh_token: encrypt(refreshToken)"));
  assert.ok(connect.includes("connected_at: new Date().toISOString()"));
  assert.ok(connect.includes("last_synced_at: null"));
  assert.ok(!connect.includes("refreshToken,\n") || !connect.includes("Response.json({ ok: true, refreshToken"));
});

test("messages are filed through the signed-in door only, and the marker moves only after they are saved", () => {
  const sync = read("src/app/api/microsoft/sync/route.ts");
  assert.ok(sync.includes('rpc("ingest_my_message"'));
  assert.ok(!sync.includes('from("inbox_items")'), "no direct inserts: the shared ingest rules must apply");
  assert.ok(sync.indexOf('rpc("ingest_my_message"') < sync.indexOf("update.last_synced_at"));
  assert.ok(sync.includes("counts.limit === 0"));
  assert.ok(sync.includes("encrypt(refreshToken)"), "a rotated refresh token is kept");
});

test("the administrator's landing page is public, outside the app's login", () => {
  assert.ok(existsSync(new URL("../src/app/microsoft-approved/page.tsx", import.meta.url)));
  assert.ok(!existsSync(new URL("../src/app/(app)/microsoft-approved", import.meta.url)));
  const page = read("src/app/microsoft-approved/page.tsx");
  assert.ok(!page.includes("authFetch") && !page.includes("supabase"), "it reads and stores nothing");
  assert.ok(!page.includes("Ask your admin") && !page.includes("friendlyAuthError"), "an administrator is not told to ask an administrator");
  assert.ok(page.includes("The approval was not completed"));
});

test("the sign-in callback checks the state value before it uses the code", () => {
  const page = read("src/app/(app)/microsoft/callback/page.tsx");
  assert.ok(page.indexOf('params.get("state") !== expected') < page.indexOf("/api/microsoft/connect"));
  assert.ok(page.includes('sessionStorage.removeItem("ms_state")'));
});

test("Settings shows the Teams panel, and the Inbox syncs only through the throttled helper", () => {
  assert.ok(read("src/app/(app)/settings/page.tsx").includes("<MicrosoftTeams />"));
  const inbox = read("src/app/(app)/inbox/page.tsx");
  assert.ok(inbox.includes("syncTeamsIfDue(authFetch, sessionStorage"));
  assert.ok(inbox.includes("setInterval(run, SYNC_EVERY_MS)") && inbox.includes("clearInterval(timer)"));
});

test("the database part of Microsoft Teams: the table is private to its owner, and the internal function cannot be called directly", () => {
  const sql = read("supabase/milestone27-teams.sql");
  assert.ok(sql.includes("alter table public.microsoft_connections enable row level security;"));
  for (const verb of ["select", "insert", "update", "delete"]) assert.ok(new RegExp(`for ${verb}`).test(sql.slice(sql.indexOf("microsoft_connections"), sql.indexOf("_ingest_chat_message"))), verb);
  assert.ok(sql.includes("revoke all on function public._ingest_chat_message(uuid, text, text, text, text, boolean, timestamptz, text, boolean, text[]) from public, anon, authenticated;"));
  assert.ok(sql.includes("revoke all on function public.ingest_my_message(text, text, text, text, boolean, timestamptz, text) from public, anon;"));
  assert.ok(sql.includes("grant execute on function public.ingest_my_message(text, text, text, text, boolean, timestamptz, text) to authenticated;"));
  assert.ok(sql.includes("uid uuid := auth.uid();"));
  assert.ok(!/service_role/i.test(sql));
  assert.equal((sql.match(/security definer/g) ?? []).length, 3, "the three functions run as their owner and set an empty search_path");
  assert.equal((sql.match(/set search_path = ''/g) ?? []).length, 3);
});

test("the WhatsApp filters do not apply to Teams, and the source is a whitelist", () => {
  const sql = read("supabase/milestone27-teams.sql");
  assert.ok(sql.includes("if v_source = 'whatsapp' then"));
  assert.ok(sql.includes("case when lower(coalesce(p_source, '')) = 'teams' then 'teams' else 'whatsapp' end"));
  assert.ok(sql.includes("'Teams chat with ' || v_sender") && sql.includes("'Teams group: ' || v_group"));
});

test("schema.sql carries the Microsoft table and the same functions as the migration", () => {
  const schema = read("supabase/schema.sql");
  const sql = read("supabase/milestone27-teams.sql");
  assert.ok(schema.includes("create table if not exists public.microsoft_connections"));
  const fn = (raw: string, name: string) => raw.slice(raw.indexOf(`create or replace function public.${name}(`), raw.indexOf("$$;", raw.indexOf(`create or replace function public.${name}(`)) + 3);
  // ingest_message moved on in Milestone 28 (event ids); tests/payload-limits.test.mts compares that one
  for (const name of ["_ingest_chat_message", "ingest_my_message"]) assert.equal(fn(schema, name), fn(sql, name), name);
});

test("the setup guide exists and names every setting the server needs", () => {
  const doc = read("docs/microsoft-teams-setup.md");
  for (const name of ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "/microsoft/callback", "/microsoft-approved", "Chat.Read", "User.Read", "offline_access"]) assert.ok(doc.includes(name), name);
});
