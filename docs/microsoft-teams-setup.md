# Microsoft Teams in ActionBrain (Milestone 27)

There are two routes. Use either, or both for different people.

| | **Route A: the Android app** | **Route B: Connect Microsoft Teams** (this page) |
|---|---|---|
| Needs an admin's approval | **No** | **Often yes** (once per organisation) |
| Works on | Your phone only, for what reaches the phone | Anything: it reads your chats from Microsoft |
| Real time | Yes, as notifications arrive | Every couple of minutes while ActionBrain's Inbox is open |
| Reads | Notifications, and open chats if live chat reading is on | Messages in your chats (one-to-one, group, meeting chats) |
| Setup | Settings → Phone messages → tick **Microsoft Teams** | Settings → **Connect Microsoft Teams** |

Route A is described in `android-app.md`. This page is route B.

## For the person using ActionBrain
1. **Settings → Microsoft Teams (chats) → Connect Microsoft Teams.**
2. Microsoft's own sign-in page opens. Sign in with your **work or school** account (personal Microsoft accounts have no Teams chats to read).
3. Microsoft lists what ActionBrain asks for: **read your chats** (and sign you in). You agree or refuse there.
4. Back in ActionBrain you see "Connected as you@company.com". New messages are imported when you open the **Inbox** and every couple of minutes while it stays open. **Sync now** does it on demand.

What it does and does not do:
- It sees only what you can already see, and **only messages from after you connected**, never your history.
- It **never writes** to Teams: it cannot send, edit or delete anything.
- It needs only one data permission, **`Chat.Read`**. A test fails if more is ever asked for.
- Your own messages are kept as "You (to Rajesh): ...", so the AI knows a promise is yours.
- Nothing is analysed by AI until you press **Analyze** (with your own key).
- **Disconnect** makes ActionBrain forget the sign-in. You can also remove ActionBrain at myaccount.microsoft.com → "Apps".

### If Microsoft says an administrator must approve it
Many organisations do not let people approve apps themselves. Microsoft then shows "Need admin approval". In ActionBrain, open **"Microsoft says an administrator must approve it? Ask your admin"**, enter your company domain (for example `contoso.com`) and send the link it creates to your Microsoft 365 administrator.
- The link contains **no secret**. It names the app and asks for the permissions listed below.
- The administrator signs in, sees exactly what is asked, and approves **once for everyone** in the organisation. They land on a public page that says "Thank you". They do not need an ActionBrain account.
- After that, you and your colleagues can connect normally.

What the administrator approves (all **delegated**, meaning "on behalf of the person signed in", never the whole company's data):

| Permission | Why |
|---|---|
| `Chat.Read` | Read the signed-in user's own chats and their messages |
| `User.Read` | Know who signed in (to tell their messages from others') |
| `offline_access` | Keep the sign-in working without asking again each time |
| `openid`, `profile` | Standard sign-in |

## For the person who runs the ActionBrain server (once)
You register ActionBrain as an app with Microsoft. It is free, and the same registration serves every organisation whose users connect.

1. Go to **https://entra.microsoft.com** → **Identity → Applications → App registrations → New registration**.
   - You need to be allowed to register apps in some Microsoft Entra directory. It can be your company's, or any free developer directory. (If "New registration" is refused, ask your administrator, or use another directory.)
2. **Name:** ActionBrain. **Supported account types:** *Accounts in any organizational directory (Any Microsoft Entra ID tenant, multitenant)*. **Not** personal accounts.
3. **Redirect URI** (platform **Web**). Add **both**, for each site you use (your deployed address, and `http://localhost:3000` for local work):
   - `https://YOUR-URL/microsoft/callback` (where signed-in users return)
   - `https://YOUR-URL/microsoft-approved` (where an administrator lands after approving)
4. **API permissions → Add a permission → Microsoft Graph → Delegated permissions:** add `Chat.Read`, `User.Read`, `offline_access`, `openid`, `profile`. Do **not** add anything else. (The administrator's link asks for exactly this list, so it must be configured here.)
5. **Certificates & secrets → New client secret.** Copy the secret's **Value** immediately (it is shown once).
6. Copy the **Application (client) ID** from the Overview page.
7. Put both in your server's settings (Vercel → Project → Settings → Environment Variables), then **redeploy**:

| Name | Value |
|---|---|
| `MICROSOFT_CLIENT_ID` | the Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | the secret's Value |
| `MICROSOFT_TENANT` | optional. Default `organizations` (any work or school account). A company can set its own domain to allow only its own people. |
| `MICROSOFT_REDIRECT_URI` / `MICROSOFT_ADMIN_REDIRECT_URI` | optional. Only if your public address differs from the one ActionBrain sees. |

8. Run the SQL **`supabase/milestone27-teams.sql`** once in the Supabase SQL Editor (it is also in `schema.sql`). Then `npm run preflight` should say "Microsoft Teams sign-in is configured" and pass the new database checks.

**Never** put the client secret in the browser, in git, or in a `NEXT_PUBLIC_` variable. `preflight` fails if a secret is found in tracked files.

### Smoother approval for your users: verify your publisher
Without it, Microsoft marks the app "unverified" and many organisations block unverified apps outright. Microsoft's **publisher verification** (a free process that proves who runs the app, through the Microsoft Partner Network) removes that warning and lets organisations that allow verified apps approve it themselves. Do this before offering ActionBrain widely. It cannot be done in code.

## How the sync works (so you can reason about it)
- Connecting stores an **encrypted refresh token** (AES-256-GCM, the same protection as the AI key) and the time you connected. No history before that is read.
- A sync reads your most recently active chats (up to 15, newest 30 messages each), keeps messages newer than the last one imported, and files them **oldest first** through the same rules as phone messages: one Inbox item per conversation, joined while the chat is active (60-minute quiet gap), a "(continued)" item when full, analyzed items never disturbed.
- Each line is stamped with the **message's own time** in your time zone (not the time of the sync), so "tomorrow" is read correctly.
- The marker only moves forward after the messages are saved, and not at all if the daily cap (300 captured messages a day) stopped the import part-way.
- Microsoft may rotate the refresh token; the new one is stored each time.
- The WhatsApp filters in Settings ("ignore groups", "only these senders") do **not** apply to Teams.

## Not built (on purpose, and why)
- **Channel messages.** They need `ChannelMessage.Read.All`, a much stronger permission that essentially always needs an administrator. On the phone, route A already captures channel posts that notify you.
- **Meeting transcripts.** They need a further permission and an organisation policy, and exist only if someone started transcription. Today: download the `.vtt` from Teams and use **Meetings → import**. The meeting's **chat** messages are covered by this route.
- **Capture while ActionBrain is closed.** Microsoft can push "new message" notifications to a public address (Graph change notifications on `/users/{id}/chats/getAllMessages`, with a lifecycle address to renew them). That needs a server that can act for a user while they are away, which means either a privileged key or a restricted function keyed by a secret. It is designed but not built; today the Inbox must be open (or press Sync now). On the phone, route A is real time.
- **Both routes at once** would add the same message twice (the server drops an identical repeat only when it is the previous line). Use one per person.

## What was tested, and what was not
**Tested:**
- Everything that does not need Microsoft, with a pretend Microsoft: the sign-in link (permissions asked, no secret), the admin link, the code exchange (secret in the body, never the URL), token refresh and rotation, every error mapping, reading chats and following pages, turning Teams HTML into text, naming conversations, telling your messages from others', planning a sync (cut-off, ordering, caps, the marker), and the routes' safety properties.
- The database part, **live**, with a test that rolls back: both entry points, the `teams` source, the filters, the time zone, who may call what.

**NOT tested. Please try these once you have registered the app:**
- **The real sign-in and consent screens**, in your organisation, and the "Need admin approval" case.
- **The shape of the real Microsoft answers.** The chat list is requested with `$expand=members,lastMessagePreview`; if Microsoft refuses that combination the code retries without the preview (then every chat is read, up to 15). Real chat and message JSON may differ from what the documentation shows.
- Rate limits, conditional-access policies, guest users, shared channels and very large chats.
- The admin link with a real tenant (it is built from the documented format).

## Troubleshooting
| What you see | What it means |
|---|---|
| "Need admin approval" (Microsoft's page) | Use **Ask your admin** and send the link. |
| "Your organisation needs an administrator..." in ActionBrain | The same, after you came back from Microsoft. |
| "That looks like a personal Microsoft account" | Sign in with your work or school account. |
| "Chat access was not granted" | You unticked the chat permission. Connect again and keep it. |
| "Microsoft access has expired or was removed" | Reconnect. (Passwords changed, or the app was removed.) |
| "Microsoft refused to share your chats" (403) | Your organisation's policy blocks it. Ask your administrator. |
| Nothing arrives | Only messages after you connected are imported. Press **Sync now**, and check that the chat had new messages. |
