# Review round 8 (27 November 2026): the offline queue and the evaluation plan

Reviewed: Phase 30 (2742320), Milestone 29 applied on the owner's Supabase, round-7 decisions (d6fba57). Both approved the queue
("persist before network, encrypt locally, stable event id, bounded storage, visible drops") and the 32A → 33 → 32B order.

## Queue hardening (applied in this round)
| Point | From | Done |
|---|---|---|
| 408 Request Timeout must be retried, not deleted | both | ✅ |
| 403 keeps messages and pauses, like 401 | ChatGPT | ✅ |
| Flush right after reconnecting with a new token, and when the app opens (Samsung battery saving delays the retry job) | Gemini | ✅ `Outbox.flushSoon` |
| Prune + insert in one SQLite transaction | ChatGPT | ✅ |
| Disconnect confirmation says how many waiting messages will be deleted | ChatGPT | ✅ |
| Unreadable row (key lost, `AEADBadTagException`) is dropped and counted, never an endless loop | Gemini | already (decrypt failure → drop + count) |
| Fresh nonce per encryption, nonce stored with the ciphertext | ChatGPT | already (Keystore cipher generates the IV; stored in front) |
| Total byte cap | ChatGPT | not added: each message is capped at about 1.7 KB (100-char sender, 1,500-char text), so 500 rows stay around 2 MB |
| Honour `Retry-After` on 429 | ChatGPT | not added: JobScheduler's exponential backoff is used; the server sends no Retry-After today |
| Do not promise instant delivery after reboot or force-stop | ChatGPT | ✅ documented in `docs/android-app.md` |

Still to verify on the Samsung: airplane mode, reboot, battery saver, the "accepted but phone crashed before deleting" case.

## Phase 31 (accuracy evaluation): what both asked for
- Metrics: precision and recall; false positives on small talk, past tense ("I already submitted it"), hypotheticals and questions;
  quote **exact** vs normalised match (do Tamil/Hindi quotes get translated?); type, owner and direction accuracy (dropped "I" in
  "Will send by tomorrow"); date accuracy, meeting date vs deadline, ambiguous dates flagged; duplicates; prompt injection; output
  validity; abstention ("unclear" when it should be); calibration (is "sure" really more reliable?); per-language results; latency
  and tokens per message (cost on free BYOK tiers).
- Datasets (ChatGPT): 30 cases are a **smoke test**, not the gate; add 200+ curated cases and a **blind hold-out** set not used for
  prompt tuning; optional shadow run on the owner's own messages, stored locally only.

## The bar before "Add sure items automatically" may be offered
The two differ; the stricter is adopted.
| | ChatGPT | Gemini | Adopted |
|---|---|---|---|
| Sure precision | ≥ 98% on the hold-out set, with the sample size and a confidence interval | ≥ 95% (19 of 20) | **≥ 98%, with at least 100 sure predictions** |
| Critical errors (injection obeyed, wrong person, invented quote, auto-created small talk) | zero | zero | zero |
| Quote grounding | 100% of auto-create candidates | ≥ 90% of actionable cases | 100% for candidates (the database already enforces it) |
| Dates | 100% correct when required; ambiguous stays in review | ≥ 90%; 100% of ambiguous flagged | both |
| Coverage / recall | report "sure coverage" separately; never lower the threshold to raise it | ≥ 80% recall (sure + review) | report both; ≥ 80% recall |
| Per language | a language with unresolved critical errors is not enabled | — | yes |
Until then the switch stays off for everyone, and later it is offered per source or category, never as a default.
