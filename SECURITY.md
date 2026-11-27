# Security policy

## Reporting a vulnerability
Please **do not open a public issue** for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on this repository
(https://github.com/afrose0719/ActionBrain/security/advisories/new). Include the steps to reproduce, the impact,
and the commit you tested. You should get a first reply within 7 days.

## Supported versions
Only the latest commit on `main`, the latest Android app release and the latest Chrome extension release get fixes.

## How ActionBrain protects data (summary)
| What | How | Limits (honest) |
|---|---|---|
| Who can read a row | Supabase Row Level Security on every table (`user_id = auth.uid()`). The app uses only the public key; no service-role key exists in the code. | One user per account. No organisations, roles or audit log yet. |
| AI keys (BYOK) | AES-256-GCM with a server key (`AI_KEY_ENCRYPTION_KEY`), decrypted only on the server for that user's own request, never sent back to the browser. | No automatic key rotation or KMS yet. |
| Google / Microsoft sign-in | Only refresh tokens are stored, AES-256-GCM encrypted. Google Calendar uses the read-only scope. | |
| Phone → server | A 256-bit intake token; only its SHA-256 hash is stored; it can only add rows to that user's Inbox, and is rate-limited. On the phone it is encrypted with a key held in the Android Keystore. | |
| Message content (Inbox, tasks, transcripts) | TLS in transit, disk encryption at rest (Supabase). | **Not end-to-end encrypted.** The server can read it. When you press **Analyze**, the text is sent in plain text to the AI provider you chose, using your own key. |
| Voice | Call recordings in the browser are transcribed **on your device** (Whisper). The audio is not uploaded. | |
| AI output | Validated against a strict allow-list, shown as a preview, applied only after you confirm. Untrusted content is wrapped as data in every prompt. | Prompt injection is reduced, not impossible. |
| Browser | CSP, `X-Frame-Options`, `nosniff`, strict referrer policy, HSTS in production (`next.config.ts`). | |

## Android builds
- `play` build: no Accessibility service. A unit test (`tests/store-compliance.test.mts`) fails if the Accessibility service is ever declared in the shared manifest.
- `full` build: adds the optional live chat reading (an Accessibility service). It is for sideloading only and is not submitted to Google Play.
