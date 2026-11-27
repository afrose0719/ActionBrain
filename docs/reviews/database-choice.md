# Is Supabase the right database? (27 November 2026, ChatGPT and Gemini)

The owner's free Supabase project was paused for inactivity, and the dashboard offered "upgrade to Pro". Asked: how to stop it pausing,
is there a completely free alternative, and is Supabase the right choice?

## Verdict (both): stay on Supabase
ActionBrain's security depends on Postgres Row Level Security, Supabase Auth (web, extension and Android), security-definer functions
and now a least-privilege worker role. Every free alternative either **also pauses** (Nhost, Appwrite) or means **rewriting** login,
per-user isolation and the server functions (Neon + separate auth, Firebase, Cloudflare D1, Turso, PocketBase). "The pause is a
free-tier availability limit, not evidence that the architecture is wrong" (ChatGPT).

| Option | Pauses? | Keeps Postgres RLS + Auth? | Effort |
|---|---|---|---|
| Supabase free (current) | after 7 days without activity; free to resume | yes | none |
| Neon + separate auth | compute sleeps and wakes in about a second; project is not paused | Postgres yes, auth must be rebuilt | high (both) |
| Self-hosted Supabase on a free VM | no | yes | low code, high operations (updates, backups, TLS); free VMs can be reclaimed or unavailable |
| Nhost / Appwrite free | yes, after a week | no / different model | high |
| Firebase, D1, Turso, PocketBase | no or n/a | no Postgres RLS | full rewrite |

Figures differ slightly between the two reviews (e.g. Neon's free storage); check the official pricing pages before acting.

## What was done
- **Daily keep-alive** (`vercel.json` → `/api/cron/keepalive`): one tiny read a day, free on Vercel Hobby. Gemini recommended this
  over GitHub Actions, whose schedules stop after 60 days without repository activity. ChatGPT's caution is recorded: Supabase does not
  promise that a synthetic request counts, so this is a safeguard, not the availability strategy.
- Real use (and zero-touch processing) also counts as activity.

## Recommended next (owner's choice)
- Keep a **backup outside Supabase** (the free plan has no automatic backups): export from Settings, or a weekly `pg_dump`.
- When people depend on ActionBrain daily: either accept occasional free-tier pauses, or pay for Supabase Pro ($25/month, no pausing).
- If $0 must hold for ever: test **Neon** (ChatGPT) or **self-hosted Supabase** (Gemini, same code) in a separate branch first. Do not
  migrate because of one pause.

## Disagreement between the reviewers
- Restore window after a pause: Gemini said 90 days; Supabase's current docs (checked 27 Nov 2026) say a paused free project can be
  restored for a year. Trust the date your dashboard shows.
