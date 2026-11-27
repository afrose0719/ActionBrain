# Review round 4 (27 November 2026): zero-touch auto-create design

I sent a design for background analysis and auto-create **before building it**, with the code both reviewers asked for pasted in
(`body.ts`, the Milestone 28 SQL, the tier rule). Both reviewers rejected the central part of it. They were right.

## Verdict on my design
| Part | ChatGPT | Gemini | Outcome |
|---|---|---|---|
| `claim_auto_work(p_token)` returns message text + encrypted key to the phone's token | **Reject**: turns a write-only token into read-and-spend | **Reject (critical)**: anyone with the token + the public anon key can call the RPC directly | ❌ Dropped. The phone token stays **write-only**. |
| WorkManager every 15 min | OK, but not exact (Doze); prefer event-triggered delayed one-time work + periodic recovery | OK; better: debounced one-time work (10 min, REPLACE) on each new notification + 6-hour fallback; never ask to ignore battery optimisation | ✅ Adopt the debounced one-time trigger + a slow periodic fallback; product wording: "usually processed in the background; Android may delay it" |
| 0.85 threshold | 0.90 + quote + owner known + clear action + date resolved if a date applies + no duplicate | 0.90 + quote + date clear + owner known | ✅ Done: high now needs ≥ 0.90, a quote, no unclear date, and a known owner for promises. Both note: 0.90 is a product threshold, not a measured accuracy. |
| Separate opt-ins | Three switches, all default off: capture, auto-analyse, auto-create (auto-create requires auto-analyse); disclosure before enabling; switching off stops new claims immediately | Same (auto_analyze, auto_create, both default off), name the provider in the disclosure | ✅ Agreed design; to build |
| Quota | Enforce the daily AI quota **atomically on the server before** the provider call | — | ✅ Agreed; to build |

## Code findings
| # | Finding | From | Outcome |
|---|---|---|---|
| F1 | **Race:** two requests with the same event id at the same moment can both pass the `exists` check and both ingest | ChatGPT | ✅ **Real bug, fixed**: `pg_advisory_xact_lock` on (user, event id) before the check; test added |
| F2 | Release the stream reader lock (`try/finally`); handle a broken stream | ChatGPT | ✅ Fixed: broken stream → 400, lock always released; test added |
| F3 | Reject arrays / non-object JSON | ChatGPT | Already done (`readJsonBody` returns null for arrays and non-objects; tested) |
| F4 | Empty body would throw on `JSON.parse("")` → 500 | Gemini | **Not a bug**: parse errors are caught and return null; `""` is in the tests |
| F5 | Add an index on `intake_events (user_id, received_at)` | Gemini | Already in Milestone 28 (not in the excerpt I pasted); now asserted by a test |
| F6 | Length limits and source allow-list inside SQL, not only in the route | ChatGPT | Already done in `_ingest_chat_message` (sender 100, text 1,500, group 100 characters; source is `teams` or else `whatsapp`) |
| F7 | `revoke ... from public` on the function | ChatGPT | Already done |
| F8 | Validate `Content-Type` on JSON routes | ChatGPT | ⏳ Low value: the body must still parse as a JSON object; left for later |

## The open decision: how background processing is authorised
Both agree the phone token must never read. They differ on what authorises the processing:
- **ChatGPT (preferred):** the phone calls the processing endpoint with the user's **signed-in session**; the server works under that user's RLS.
- **Gemini:** the phone token only **triggers**; the server resolves the user id (no content returned) and claims work with a **server-only secret** (its hash in a locked table) that the phone never sees.

**My recommendation: Gemini's shape, with ChatGPT's quota rule**, because:
1. The Android app's session lives inside the WebView. A background worker would need the user's **refresh token** copied into native storage, which can do everything the account can (read all data, delete the account). That gives the phone *more* power, against ChatGPT's own principle.
2. With the server-secret gate, a stolen phone token can still read **nothing**. Its worst case is triggering analysis of the user's own new items, capped by the atomic daily quota, and only if the user switched auto-analyse on.
3. ChatGPT's concern was the secret travelling as an RPC argument. It goes only from the Vercel server to Supabase over TLS, is 256 bits, and only its hash is stored. Alternative if they still object: a dedicated Postgres role with a server-held JWT, which needs the JWT secret on Vercel (close to a service-role key, which this project avoids).

This goes back to both reviewers in round 5 before anything is built.

## Still to build (agreed)
Server-secret worker functions; `auto_analyze` / `auto_create` switches with disclosure; atomic daily quota; the "Added automatically" list with 7-day Undo; Android debounced trigger + encrypted bounded offline queue + `MessagingStyle` parsing.
