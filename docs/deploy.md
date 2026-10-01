# Deploying ActionBrain (Vercel + Supabase)

Free tiers are enough to start. You do the account steps; nothing here needs a credit card.

## Before you deploy: checklist
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass (CI does this).
- [ ] `supabase/schema.sql` has been run in your Supabase project.
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
| `NEXT_PUBLIC_SUPABASE_URL` | same as `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the publishable key |
| `AI_KEY_ENCRYPTION_KEY` | **the same value as in `.env.local`**, otherwise keys users already saved cannot be read |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | only if you use Calendar |

4. Click **Deploy**. You get a URL like `https://actionbrain-xyz.vercel.app`.

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

## Operating it
- **Backups:** Supabase's free tier has no automatic backups you control. Export important data periodically, or upgrade for point-in-time recovery.
- **Updates:** push to `main`; Vercel redeploys automatically and CI runs first.
- **If a user's saved AI key stops working** ("could not be read"): the encryption key changed. They re-enter it in Settings.
- **Errors:** `src/app/error.tsx` has a spot to send errors to a reporting service such as Sentry.

## Known limitations
- Sessions are checked in the browser. The database is protected by Row Level Security regardless, but pages briefly show a loading state before redirecting a logged-out visitor.
- There is no rate limiting on the AI routes. Each user pays for their own AI use, so the risk is self-inflicted cost, not abuse of yours. Add per-user limits (for example with Upstash Redis) before a large public launch.
- Google Calendar in Testing mode needs reconnecting weekly until the Google app is published.
