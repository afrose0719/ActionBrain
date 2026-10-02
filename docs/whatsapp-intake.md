# Phone messages: WhatsApp notifications into your Inbox (Milestone 22)

An automation app on your **Android** phone watches for WhatsApp notifications and sends each one to your private ActionBrain address. The message lands in your **Inbox**. Nothing becomes a task or commitment until you approve it.

## Why this way (and not another)
- WhatsApp's official API is for **business** numbers only.
- Tools that log into a personal number in the background (WhatsApp Web libraries) break WhatsApp's terms and can get the number **banned**. ActionBrain does not do that.
- Reading **your own phone's notifications** with an app you install and permit is an Android feature. ActionBrain never touches WhatsApp's servers.

> **Easiest way:** the ActionBrain Android app does all of this by itself, with no automation app and no copy-paste. See `android-app.md`. The rest of this page is for the address itself, and for using an automation app instead.

## What you need
1. ActionBrain **deployed** (the phone must reach a public address). See `deploy.md`.
2. The Supabase SQL for this milestone run once: `supabase/milestone22-intake.sql`.
3. An Android automation app that can (a) trigger on a notification and (b) send an HTTP POST: **MacroDroid** or **Tasker**.

## Setup
1. In ActionBrain: **Settings → Phone messages (WhatsApp)**, tick the box, **Create my private link**.
2. Copy the **Address** and the **Token**. The token is shown **once**; only a scrambled copy (SHA-256) is kept. Lost it? Press **New token** (the old one stops working).
3. In your automation app, create one rule:
   - **Trigger:** a notification is received from **WhatsApp** (add **WhatsApp Business** if you use it). Grant the app *Notification access* when Android asks.
   - **Action:** HTTP request, method **POST**, to the Address.
   - **Header:** `Authorization` = the token box value (it already starts with `Bearer `).
   - **Content type:** `text/plain`.
   - **Body:** the notification **title**, then a **new line**, then the notification **text**. Use the app's variable/"magic text" picker for the two values.
4. In ActionBrain, set the **filters**: ignore groups, and/or list the people you want (one name per line, exactly as WhatsApp shows them).
5. Send yourself a test from another phone. It should appear in **Inbox** within seconds, with a "N messages waiting to be analyzed" bar.
6. Press **Analyze** when you open the app. Detected commitments go to **Commitments → review queue**; suggested tasks stay on the message until you create or dismiss them.

## What the address accepts
`POST /api/intake` with the token in `Authorization: Bearer abi_...` (or the header `x-actionbrain-token`).

- **Plain text** (easiest, nothing to escape): the **first line** is who it is from, the **rest** is the message.
- **JSON** (for apps that escape properly): `{"title": "Rajesh", "text": "...", "group": "optional"}`. `sender` and `message` also work.

Answers: `{"status":"stored"}`, `"duplicate"` (the same notification twice), `"ignored"` (filtered), `"limit"` (see below), or an error (`401` bad token, `413` too large).

## What is filtered out
- WhatsApp's own notices ("Checking for new messages", "WhatsApp Web is currently active", "3 new messages", call notices, backup).
- Photos, voice notes, stickers and emoji-only messages: there are no words to read.
- Groups, if you turn that on, and anyone not on your allowed list, if you have one. **The allowed list is the dependable filter.** Group detection is best effort, because it relies on how your WhatsApp version words the notification title.

## How messages are stored
- Each line is stamped with **your** local time, so the AI reads "tomorrow" as tomorrow from when it was sent, even if you analyze it hours later.
- Messages from the same person within **5 minutes** join one Inbox item, so the AI sees the conversation.
- Up to **300 phone messages a day** are accepted; beyond that the address answers `limit`. This stops a leaked token from flooding your Inbox.
- **Analyze** works on up to **10 messages per click** and stops at the first error, so a busy phone cannot spend your AI budget in one go.

## Privacy and consent
- Your contacts did not agree to this. Their messages are **stored in your account** and, when you analyze them, **sent to your own AI provider** with your key. Use the allowed list to limit it to people you choose, and delete items you do not want (Inbox → Archive; **Settings → Delete my account** removes everything).
- Only the notification **preview** is available: long messages arrive cut off, and a message you already opened may not trigger a notification.
- Treat the token like a password. Anyone who has it can add messages to your Inbox (they cannot read anything). If it leaks: **Settings → New token**, then **Turn off** if unsure.

## Security design
- The phone is not logged in, so it cannot use your account directly. It calls one database function (`ingest_message`) that finds you by the token's hash and can only **add** Inbox rows for you. It reads nothing back.
- The token is 256 random bits; only its SHA-256 hash is stored. No service-role key is used anywhere.
- The function refuses anything that is not a well-formed token before it queries, caps text length, and answers `invalid` identically for any wrong token.
- Not built: **rate limiting by IP** (a wrong-token flood only costs a database lookup per request). Add it at your host if you open this to many users.

## What was tested, and what was not
**Tested for real** (dev server, your real Supabase database, Chrome, and your AI key):
- Creating the token in Settings, then the full path: notification → `/api/intake` → Inbox → **Analyze** → a suggested task and commitments in the review queue.
- Duplicate suppression, joining a conversation, `(N messages)` titles, system notices, photo notices (sent as real UTF-8), JSON with quotes and backslashes, group messages ignored, wrong/missing/malformed token, bad JSON, oversized body, wrong HTTP method.
- A revoked token stops working immediately. Test data and the test token were removed afterwards.
- 24 unit tests (`tests/intake.test.mts`), including checks that the SQL and the code agree on the token format and the hash. Breaking either on purpose makes them fail.

**NOT tested. Please try these yourself:**
- **A real phone.** I could not run MacroDroid or Tasker. The setup steps above describe those apps from general knowledge; menu names and the variables for "notification title/text" differ by app and version.
- **The exact wording of WhatsApp notifications** on your phone (group titles, bundled "N messages" titles, system notices). The filters are built from known patterns and may miss yours. If something slips through, tell me the notification text.
- **Battery savers.** Many phones stop background apps. Exempt your automation app.
- **The allowed list with names containing emoji or unusual spacing.**
- **Screen readers and the new Settings panel** (the other panels were audited; this one was not run through axe).
- **Delivery when the phone is offline.** A failed request is up to the automation app to retry.
