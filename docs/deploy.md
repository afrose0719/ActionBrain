# Deploying ActionBrain (Vercel + Supabase)

Free tiers are enough to start. You do the account steps; nothing here needs a credit card.

## Step 0: run the pre-flight check
```bash
npm run preflight
```
It changes nothing. It checks your settings, your Supabase database (every table exists, Row Level Security is on, the delete function is installed) and your git repo (no `.env` files tracked, no secrets in any file or in the history). It exits with an error if something would break or leak.

It refuses, for example, a **secret/service_role key in `NEXT_PUBLIC_SUPABASE_ANON_KEY`**. Anything starting with `NEXT_PUBLIC_` is sent to every visitor's browser, so a secret key there would let anyone bypass all data protection.

Warnings are not blockers but read them: **"Email confirmation is OFF"** means anyone can sign up with someone else's email address. Fine while it is just you, not for a public launch.

## Before you deploy: checklist
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass (CI does this).
- [ ] `supabase/schema.sql` has been run in your Supabase project. It includes the `delete_my_account` function that powers **Settings → Delete my account**.
- [ ] You **rotated any key you ever pasted into a chat or an email** (Supabase → Project Settings → API Keys).
- [ ] `.env.local` is not committed (it is git-ignored).

## 1. Put the code on GitHub
Already done: https://github.com/afrose0719/ActionBrain. Consider making it **Private** under repo Settings.

## 2. Create the Vercel project
1. Sign in at https://vercel.com with GitHub.
2. **Add New → Project**, import `ActionBrain`. Framework: Next.js (auto-detected).
3. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → Data API → **Project URL** (same as `.env.local`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → the **publishable** key (`sb_publishable_...`). **Never** the secret key. |
| `AI_KEY_ENCRYPTION_KEY` | **the same value as in `.env.local`**, otherwise keys users already saved cannot be read |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | only if you use Calendar |

4. Click **Deploy**. You get a URL like `https://actionbrain-xyz.vercel.app`.
5. Open `https://YOUR-URL/api/health`. It should show `{"status":"ok", ...}`. If it says `degraded`, a variable is missing or wrong: `supabase: false` means the two Supabase variables, `encryptionKey: false` means `AI_KEY_ENCRYPTION_KEY`. After fixing a variable in Vercel, redeploy (Deployments → ⋯ → Redeploy), because variables are read at build time.
6. Optional: point a free uptime monitor (UptimeRobot, Better Stack) at `/api/health`. It makes no database or AI calls, so checking it every minute costs nothing.

## 3. Tell Supabase about the new address
Supabase → **Authentication → URL Configuration**:
- **Site URL**: your Vercel URL.
- **Redirect URLs**: add `https://YOUR-URL/**` and keep `http://localhost:3000/**` for local work.

Without this, password-reset and confirmation emails send people to the wrong place.

## 4. Update the other places that know your address
- **Google Calendar:** in Google Cloud, add `https://YOUR-URL/google/callback` to the OAuth client's **Authorized redirect URIs**.
- **Chrome extension:** set `APP_URL` in `extension/config.js` to your URL, then reload the extension.

## 5. Email for sign-up and password reset
Supabase's built-in email sender is for testing and allows only a few emails per hour. For real users, add your own SMTP provider under **Authentication → SMTP Settings** (Resend, Postmark, SendGrid and others have free tiers). Decide whether to keep **Confirm email** on. For a public app, keep it on.

## 6. Smoke test on the live site
1. Sign up, log in, log out, then use **Forgot password?** and complete a reset.
2. Settings → save your name and an AI key (it should say "Verify & save" succeeded).
3. Create a task with the command box, then confirm it.
4. Inbox → add a message → Analyze → create a task.
5. Open the site's developer console: there should be **no Content-Security-Policy errors**. If you add a new third-party service (analytics, a CDN), add its domain to `connect-src` / `script-src` in `next.config.ts`.

## 6b. Install it on your phone
Installing needs the **HTTPS** address, so do this after deploying.
- **Android (Chrome):** open the site → menu → **Install app**. Afterwards, **Share → ActionBrain** in WhatsApp, Gmail or any app drops the text into your Inbox form.
- **iPhone / iPad (Safari):** **Share → Add to Home Screen**. (iOS does not support the Share-to-app feature.)
- **Desktop (Chrome/Edge):** click the install icon in the address bar, or Settings → Install the app.

Notes:
- The service worker (`public/sw.js`) only shows `public/offline.html` when a page cannot load. It never stores your data. If you edit `offline.html`, bump the cache number at the top of `sw.js`.
- Desktop reminders come from the Chrome extension. Phone **push** reminders would need a push server and are not built yet.

## Privacy and users' data
- Users can export their data and delete their account themselves in **Settings → Your data**.
- Deleting an account removes everything: all tables cascade from the user. Revoking Google Calendar access is attempted first.
- Add a privacy policy before inviting the public. It should say what is stored (tasks, commitments, messages, meetings, an encrypted AI key), that AI requests go to the provider the user chose with their own key, and that voice input uses the browser's speech service.
- Backups you keep of the database will still contain deleted users until they expire, so mention your retention period.

## Operating it
- **Backups:** Supabase's free tier has no automatic backups you control. Export important data periodically, or upgrade for point-in-time recovery.
- **Updates:** push to `main`; Vercel redeploys automatically and CI runs first.
- **If a user's saved AI key stops working** ("could not be read"): the encryption key changed. They re-enter it in Settings.
- **Errors:** `src/app/error.tsx` has a spot to send errors to a reporting service such as Sentry.

## Known limitations
- Sessions are checked in the browser. The database is protected by Row Level Security regardless, but pages briefly show a loading state before redirecting a logged-out visitor.
- There is no rate limiting on the AI routes. Each user pays for their own AI use, so the risk is self-inflicted cost, not abuse of yours. Add per-user limits (for example with Upstash Redis) before a large public launch.
- Google Calendar in Testing mode needs reconnecting weekly until the Google app is published.
