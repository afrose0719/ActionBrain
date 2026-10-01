# Integrations: research and decisions (Milestone 12)

Researched 2026-10-01. For each service: is it free, what permissions it needs, what data we can read, the limits, and a simpler alternative for the demo.

Legend: **[official]** read from the provider's own docs this session. **[3rd-party]** from blog or vendor articles, so re-check before relying on it. **[unverified]** not confirmed.

## Summary

| Service | Free to use? | Hard part | Simpler alternative (built) |
|---|---|---|---|
| **Gmail API** | API access: pricing not stated on the pages read **[unverified]**. | Every read scope is **restricted**: `gmail.readonly`, `gmail.metadata`, `gmail.modify` **[official]**. Public release needs Google verification plus a security assessment (CASA Tier 2) **[3rd-party]**. CASA cost **[unverified]**. | **Import a `.eml` file** into the Inbox (done), or use the Chrome extension on Gmail (done). |
| **Google Calendar API** | Scopes are free to request. | Read-only event scopes (`calendar.events.readonly`, `calendar.readonly`) are **non-sensitive** **[official]**, so no verification review should be needed. Needs a Google Cloud project and OAuth client. | Not needed yet. This is the best first real integration (see roadmap). |
| **WhatsApp Business Platform (Cloud API)** | A test number needs no payment method **[official]**. Production is charged per delivered template message **[3rd-party]**. Replies to customer-started chats within 24h are free **[3rd-party]**. | It **cannot read personal WhatsApp chats**. It only sees messages sent to a business number **[official]**. Needs a Business Account and a dedicated phone number **[official]**. | **Import a WhatsApp "Export chat" `.txt`** into the Inbox (done). |
| **Microsoft Graph (Outlook / Calendar)** | Graph is free to use, including personal accounts **[official]**. | `Calendars.Read` (delegated) needs no admin consent **[official]**. Whether `Mail.Read` needs admin consent in a company tenant was **[unverified]**. | `.eml` import works for Outlook too (Save as). |
| **Slack / Zoom / Teams** | Not researched. | | Paste, or upload the `.vtt` caption file in Meetings (done). |

## Google OAuth testing mode **[3rd-party]**
- An external app in "Testing" is limited to **100 test users**.
- Refresh tokens expire after **7 days** unless the app is published.
- Publishing with only non-sensitive scopes avoids the verification review. Restricted scopes (Gmail) cannot skip it.
- For a single user or a small demo, Testing mode works. You would re-connect weekly.

## Security notes for any OAuth integration
- Store third-party tokens **encrypted** (same AES-256-GCM helper as AI keys, `src/lib/crypto.ts`). Never in plain text.
- Request the **narrowest read-only scope** (`calendar.events.readonly`, not `calendar`).
- Keep the Google client secret in server env vars only.
- Provide a "Disconnect" button that deletes the stored token and revokes it with the provider.
- Treat everything fetched (email bodies, event descriptions) as **untrusted data**, the same as today.

## Recommended roadmap
1. **Done now (free, no verification, private):** paste, Chrome extension, `.eml` import, WhatsApp export import, transcript/`.vtt` upload.
2. **Next real integration: Google Calendar, read-only.** Free, non-sensitive scope. Use: list today's and upcoming events, pre-fill a Meeting (title, time, attendees) so you only paste the transcript afterwards.
3. **Then Gmail, if you want it.** Fine for yourself in Testing mode (7-day re-connect). Going public means verification and CASA, so budget time and cost, and confirm current requirements first.
4. **WhatsApp Business Cloud API only if you have a business number** whose messages you want captured. It will not replace chat export for personal chats.

## Sources
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
- Calendar scopes: https://developers.google.com/workspace/calendar/api/auth
- WhatsApp Cloud API overview: https://developers.facebook.com/docs/whatsapp/cloud-api/overview
- Microsoft Graph permissions: https://learn.microsoft.com/en-us/graph/permissions-reference
- Google OAuth limits (third-party summary): https://www.unipile.com/google-oauth-100-user-limit/ and https://www.unipile.com/google-oauth-refresh-token/
- WhatsApp pricing (third-party summaries; confirm on Meta's pricing page): https://www.engagelab.com/blog/whatsapp-business-api-pricing and https://blueticks.co/blog/whatsapp-business-pricing-change-2026-per-message
