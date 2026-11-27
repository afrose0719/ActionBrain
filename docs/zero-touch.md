# Zero-touch processing (Milestone 29)

Phone messages are analysed in the background, and, only if you switch it on, the items the AI is sure about become tasks and
promises by themselves. Designed with ChatGPT and Gemini over review rounds 4 and 5 (`docs/reviews/round-4.md`, `round-5.md`).

## What happens
1. The Android app captures a WhatsApp or Teams notification and sends it to your Inbox (as before).
2. About 10 minutes later (Android decides the exact moment; it can be later in battery-saving mode), the app asks the server to
   process conversations that have been quiet for 10 minutes. A 6-hour job catches anything left over.
3. If **Analyse automatically** is on, the server analyses up to 3 conversations per request with **your** AI key, at most
   **50 a day**. Suggestions wait in the Inbox.
4. If **Add sure items automatically** is also on, items with confidence ≥ 0.90, an exact quote, a clear date and (for promises) a
   known person are added at once. They appear under **Added automatically** in the Inbox, with Undo for 7 days.

Both switches are **off** by default (Settings → Automatic). Turning one on shows what it does and needs **Agree**.

## Security (why the phone cannot read anything)
- The phone keeps only its **write-only** intake token. It never holds your login.
- Reading messages and the encrypted AI key happens in the private database schema `worker`. The public API does not expose it,
  and only the database login `actionbrain_worker` may execute its three functions. That login's password exists only on the
  server (Vercel). It has no access to any table of its own.
- A stolen phone token can still read nothing. At worst it can make the server analyse your own new messages, only if you
  switched that on, and never more than 50 a day.
- The database itself decides what is "sure". A label sent by the model or the server cannot add a task.
- Still no service-role key and no JWT secret anywhere.

## Set it up (once)
1. **Supabase → SQL Editor:** run `supabase/milestone28-event-ids.sql` (if not done yet), then `supabase/milestone29-zero-touch.sql`.
2. **Create the worker login.** Make a password: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   Then run, each line on its own, with your password:
   ```sql
   create role actionbrain_worker with login password 'YOUR-PASSWORD' noinherit;
   grant usage on schema worker to actionbrain_worker;
   grant execute on function worker.claim_auto_work(text, integer), worker.save_auto_result(text, uuid, uuid, jsonb, jsonb), worker.fail_auto_work(text, uuid, uuid) to actionbrain_worker;
   ```
3. **Vercel → Project → Settings → Environment Variables:**
   - `WORKER_DATABASE_URL`: Supabase → **Connect** → **Transaction pooler** connection string, with the user changed to
     `actionbrain_worker.<your-project-ref>` and your password. Example shape:
     `postgresql://actionbrain_worker.abcdefgh:YOUR-PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`
   - `WORKER_DATABASE_CA`: Supabase → **Database Settings → SSL Configuration → Download certificate**; paste its text.
     Without it the connection is still encrypted, but the server does not verify it is talking to Supabase.
   - `CRON_SECRET`: any long random string (protects the daily keep-alive below).
4. Redeploy. Install Android app **0.6.0** on the phone.
5. In ActionBrain **Settings → Automatic**, turn on **Analyse automatically** (and, if you want, **Add sure items automatically**).

## Keeping the free Supabase project awake
Free Supabase projects pause after 7 days without database activity. `vercel.json` runs `/api/cron/keepalive` once a day: one tiny
read that returns nothing. Both reviewers preferred this over a GitHub Actions schedule, which stops after 60 days without
repository activity. It is a safeguard, not a guarantee: Supabase does not promise that any particular request counts. Real use
(and zero-touch processing) also counts. If the project pauses anyway, resume it from the Supabase dashboard (free).

## What is not done or not verified
- **The SQL runs in a real Postgres in CI** (`tests/sql.test.mts`, PGlite): claims, leases, quota, switches, what counts as sure,
  provenance, and the privileges (anon refused; the worker role can run the functions but cannot read any table). It is **not yet run
  against your Supabase project**, and the route (`/api/intake/process`) and the Android job are covered by unit and static tests only
  (`tests/zero-touch.test.mts`, `AutoProcessTest.kt`), not on a phone.
- **The daily summary is in the app** (the Inbox line "Today, ActionBrain added N items automatically"), not a phone notification.
  A phone notification would need Android's notification permission and another disclosure; that is a later step.
- **Accuracy is not measured.** 0.90 is a starting threshold agreed in review, not a proven accuracy. Use Undo, and tell us what it
  gets wrong.
- **Backups:** the Supabase free plan has no automatic backups. Export your data from Settings regularly.
