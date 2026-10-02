# ActionBrain

**Never lose a commitment again.** ActionBrain is an AI work memory. It captures what you say, receive and promise, finds the commitments and action items in it, and turns them into tasks you approve.

## What it does
| Area | What you can do |
|---|---|
| **Tasks** | Create, edit, complete, delete, search. Priority, due date, source and "why does this exist?" provenance. |
| **AI command box** | "Remind me to send the RCA tomorrow at 10", "Move the RCA task to Friday". Validated, then confirmed by you. Works by voice too. |
| **Inbox** | Paste a message, import a WhatsApp chat export or `.eml` email, or send selected text from any web page (Chrome extension). AI suggests tasks and commitments. Nothing is created without your approval. |
| **Commitments** | What you promised and what others promised you, with a review queue and at-risk warnings. |
| **Waiting For** | Everything others owe you, grouped by person, with an AI briefing ("who should I chase today?"). |
| **Record a call** | Press Record in Meetings. Your voice is transcribed **on your own device** (private, free, no upload) and turned into suggested tasks and commitments. See `docs/call-recording.md` for speed, limits and what is untested. |
| **ActionBrain Android app** | A small native app (`android/`) that opens your site and forwards WhatsApp messages to your Inbox by itself, with no third-party automation app. Sideloaded APK. See `docs/android-app.md`. |
| **Phone messages (WhatsApp, Android)** | An automation app on your phone sends WhatsApp notifications to your private address; they land in the Inbox for you to analyze and approve. No WhatsApp login, no ban risk. See `docs/whatsapp-intake.md`. |
| **Phone call recordings (Android)** | Record calls with your phone's own recorder, then **Share → ActionBrain**. It is transcribed on the phone (private, free) and turned into suggested tasks and commitments. See `docs/android-call-recordings.md`. |
| **Meetings** | Paste or upload a transcript (`.txt`, `.vtt`, `.srt`). Get a summary, decisions, your action items and commitments. Optionally pick the meeting from Google Calendar. |
| **Reminders** | The Chrome extension shows desktop notifications for due and overdue tasks and commitments, and "time to chase" nudges. The dashboard lists everything waiting for your review. |
| **Install as an app** | Add ActionBrain to your phone or desktop (a PWA). On Android, **Share → ActionBrain** from WhatsApp, Gmail or any app sends the text to your Inbox. Shows a friendly offline page without a connection. |
| **Your data** | Export everything as JSON (or tasks as CSV), and permanently delete your account and all data from Settings. |
| **Search** | Ask questions across your tasks, commitments and messages. Answers cite their sources. |

**Bring your own AI key.** Each user adds their own Anthropic, OpenAI or Gemini key in Settings. It is stored encrypted and never shown again, so the app owner never pays for anyone's AI use.

## Tech
Next.js (App Router) · TypeScript · Tailwind CSS v4 · Supabase (Postgres, Auth, Row Level Security) · Chrome extension (Manifest V3).

## Run it locally
1. `npm install`
2. Create a free Supabase project. In the SQL Editor, run `supabase/schema.sql` (it contains every table).
3. Copy `.env.example` to `.env.local` and fill it in (table below).
4. `npm run dev` and open http://localhost:3000.

### Environment variables
| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | The **publishable** key. Never the secret / service_role key. |
| `AI_KEY_ENCRYPTION_KEY` | yes | 32 random bytes, base64. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Losing it means users must re-enter their AI keys. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Google Calendar. See `docs/google-calendar-setup.md`. |

## Scripts
| Command | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm run dev` / `npm run build` also run `scripts/copy-ort.mjs` first | Copies the 25.6 MB speech engine into `public/ort` (not committed). |
| `npm run preflight` | Checks the project is ready to deploy (settings, database, leaked secrets). Changes nothing. |
| `npm test` | Unit tests for the validators, encryption, parsers and Google logic |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests and build on every push. `npm run typecheck` generates Next.js route types first, so it also works on a fresh clone.

## Chrome extension
See `extension/README.md`. Load the `extension` folder at `chrome://extensions` (Developer mode → Load unpacked).

## Security model
- **Row Level Security** on every table: a user can only read and write their own rows. The app uses only the public key. No service-role key is needed anywhere.
- **The AI never writes to the database.** Its output is validated against a strict allow-list (no invented ids, no `user_id`/`status` changes), shown as a preview, and applied only after you click Confirm.
- **AI keys** are encrypted with AES-256-GCM before storage and are only decrypted server-side to make that user's own request.
- **Google Calendar** uses the read-only scope; only an encrypted refresh token is stored, never your events.
- **Prompt injection:** emails, chats and transcripts are treated as untrusted data in every prompt, and their output goes through the same validation and approval.
- **Data ownership:** exports read every row (not just the first 1,000), never include AI keys or Google tokens, and neutralise spreadsheet formulas in CSV. Account deletion runs through one locked-down database function (`delete_my_account`) that can only delete the caller's own account, so no admin key is ever needed.
- **Browser hardening:** a Content Security Policy, `X-Frame-Options`, `nosniff`, a strict referrer policy and HSTS (production). See `next.config.ts` for the trade-offs.

## Docs
- `docs/deploy.md`: deploying to Vercel, step by step
- `docs/android-app.md`: the Android app (Milestone 23): install, first run, build, security, what is untested
- `docs/whatsapp-intake.md`: WhatsApp notifications into the Inbox (Milestone 22): setup, filters, privacy, security, what is untested
- `docs/android-call-recordings.md`: free Android call-recording flow (India-friendly), setup, limits, what is untested
- `docs/call-recording.md`: on-device call recording: privacy, measured speed, security design, what is untested
- `docs/accessibility.md`: accessibility standard, audit results, and what is still untested
- `docs/google-calendar-setup.md`: Google Calendar setup
- `docs/integrations.md`: research on Gmail, WhatsApp, Calendar and Microsoft, with sources
- `supabase/`: SQL for each milestone
