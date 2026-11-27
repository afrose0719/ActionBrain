# Review round 5 (27 November 2026): how background processing is authorised

Question: what lets the server analyse new phone messages while the app is closed, without giving the phone more power?

## Rulings
| Point | ChatGPT | Gemini | Decision |
|---|---|---|---|
| Server-side worker vs the user's signed-in session on the phone | **Accepts** the server-side design: a background job should not hold a refresh token with full account authority | **Still prefers** the server-side design, for the same reason | ✅ No refresh token on the phone. The phone token stays **write-only**. |
| How the server proves it is the worker | **Dedicated Postgres login role** (`actionbrain_worker`) whose password lives only on Vercel, connecting through Supabase's transaction pooler. It may only execute the worker functions; no direct table access. No JWT secret needed. A secret passed to anon-callable RPCs is acceptable only as a temporary design. | Revoke `EXECUTE` on the worker functions from `PUBLIC`, `anon`, `authenticated`; keep a hashed secret check inside them | ✅ **Dedicated worker role.** Gemini's two conditions only work together this way: if `anon` cannot execute the functions, the server cannot call them with the public key either, so it needs its own database login. That login is ChatGPT's role. |
| Where the functions live | A **private, non-exposed schema**; `search_path = ''`; fully qualified names; ownership checks | Same hardening | ✅ `worker` schema, not exposed to the REST API |
| `resolve_intake_user(p_token)` | May be anon-callable; returns only the user id; rate-limited | Same; also check the token is not revoked | ✅ |
| Quota | Reserve it **inside the claim**, atomically, **idempotent per item** (a retry does not count twice); decide refund on provider failure | Reserve only when at least one quiet item exists | ✅ Claim = lease + quota in one transaction; no items, no quota used. A provider failure keeps the reservation (protects the user's bill against retry loops) and marks the item retryable. |
| Claim state | Claim id, lease expiry and safe reclaim, max items and output bytes per claim, `new → processing → analyzed / failed` | `save_auto_result` only accepts an item in `processing` under that lease | ✅ |
| Never trust the model's labels | The model can never cause an insert by saying "high"; the server computes eligibility and the database re-checks the claim | Re-validate `auto_create` and tier in SQL | ✅ (already: tier is computed by the server) |
| Switches | Auto-analyse OFF stops new claims; auto-create OFF stops inserts **even for items already claimed** | Same | ✅ Checked at claim time and again at save time |
| Duplicate tasks | Unique source-item/task key | — | ✅ |
| Android trigger | `REPLACE` cancels running work: use a **per-conversation key**, or a single worker that drains all eligible items | 10-min `REPLACE` debounce + 6-hour fallback; no battery exemption, no exact alarms | ✅ Debounce with `KEEP`-safe design: one unique "drain" worker; new notifications only push its start later if it has not started yet |
| Safety net | 7-day "Added automatically" + Undo is **mandatory**; also a lightweight **daily summary in v1**, on when auto-create is on, can be turned off, no extra AI call | Undo list mandatory; daily summary nice-to-have, never empty | ✅ Both: Undo list + a daily summary only on days something was added, switchable off |
| Provenance | Keep "AI-generated" and the source link permanently; Undo removes the task, not the message | — | ✅ |

## What this costs the owner
- One new Vercel environment variable: the worker role's connection string (`WORKER_DATABASE_URL`).
- One new npm dependency for a direct Postgres connection (`pg`), used only by the worker route.
- Still no service-role key and no JWT secret.

## Ready to build (both gave the green light)
1. Migration 29: `worker` schema, `actionbrain_worker` role (created by the owner in the SQL editor with their own password), `resolve_intake_user`, `claim_auto_work` (lease + quota), `save_auto_result`, `user_ai_settings.auto_analyze` / `auto_create` (default false), auto-created provenance and a unique source key.
2. `POST /api/intake/process`: phone token → user id → worker claim → decrypt key → AI → validate → tier → save.
3. Settings: three switches with disclosure; "Added automatically" list with Undo; privacy and Data safety text.
4. Android: debounced drain worker + 6-hour fallback; daily summary notification.
