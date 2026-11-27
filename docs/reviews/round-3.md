# Review round 3 (27 November 2026): rulings on my disagreements, and the agreed plan

Build reviewed: PR #1 at `d4d789c`. Both reviewers again said GitHub did not return the code, so this is a design and policy review of the
written summary, not a code approval. ChatGPT asked for these files to be pasted next time: `docs/reviews/round-2.md`, `src/lib/body.ts`,
the Milestone 28 SQL, the intake route and token code, the AI extraction schema/prompt/auto-create code, and the Android queue.

## Rulings on my disagreements (round-2 doc, "Disagreements")
| # | My position | ChatGPT | Gemini |
|---|---|---|---|
| a | Token revoke already exists; no `revoked_at` needed | Agree (only for an audit trail) | Accepted |
| b | No ZIP import, so no ZIP limits | Agree; drop ZIP from the threat model | Accepted |
| c | Auto-create default **off** | Strongly agree | Accepted (withdrew "default true") |
| d | `TelephonyCallback` + `READ_PHONE_STATE`, no `READ_CALL_LOG` | Agree. **Caveat:** it reports cellular calls only, not WhatsApp/Teams (VoIP) calls | Agree. **Caveat:** `READ_PHONE_STATE` also needs a disclosure and Play justification |
| e | First Play build without Accessibility, separate update later | Agree. **Caveat:** a later declaration is not guaranteed approval; treat it as its own policy decision | Agree: "the exact right risk-containment move" |
| f | CASA price is not official; Apps Script Gmail bridge is good | Agree, but Apps Script still needs least-privilege scopes, a deployment/revoke guide, and disclosure; "free for users", not "no compliance burden" | Agree; prices are set by labs, not Google |
| g | Teams meeting transcripts need admin consent, so optional | — | Accepted |

## New details to carry into the work (nothing dropped)
| # | Detail | From | Where it goes |
|---|---|---|---|
| N1 | `owner_direction`: me / them / shared / unknown (not only self/other) | ChatGPT | Instruction 1 |
| N2 | Each extracted item carries **source evidence** (a short exact excerpt) | ChatGPT | Instruction 1 |
| N3 | Negative tests: ordinary chat → no task; wrong owner; ambiguous date; duplicate; prompt injection; false positives | ChatGPT | Instruction 1 |
| N4 | Do not silently guess an ambiguous date; keep the source timestamp and timezone for traceability | ChatGPT | Instruction 1 |
| N5 | Even with auto-create on, the AI never sends messages, changes settings or follows instructions inside captured content | ChatGPT | Instruction 1 (already true: allow-list) |
| N6 | Offline queue is **bounded**, survives reboot, user can pause and clear it; revoke stops queued uploads; test storage exhaustion | ChatGPT | Instruction 2 |
| N7 | Parse `MessagingStyle` defensively (content may be missing) | ChatGPT | Instruction 2 |
| N8 | Personal/Work as a user-level space, not enterprise multi-tenancy | ChatGPT | Instruction 3 |
| N9 | Release gates in parallel: run Milestone 28 SQL, verify revoke/rotate live, phone-test dialogs, set privacy contact, signing, internal test, final Data safety | ChatGPT | Owner + later rounds |

## Agreed order (both)
1. AI structured output + multilingual + confidence routing, auto-create opt-in (default off); tests for Scenarios A, B, D and the negative cases.
2. Android encrypted, bounded offline queue (Room + WorkManager + Keystore) sending `x-actionbrain-event-id`; `MessagingStyle` parsing.
3. Personal / Work spaces, Today view, simpler mobile-first navigation.

## Done in this round for Instruction 1 (part 1 of 2)
- Every extracted task and promise now carries `language` (en, ta, hi, ml, te, kn, ta-Latn, hi-Latn, mixed, other), `date_unclear`, and a `tier`
  (high >= 0.85, review 0.60-0.84, clarify < 0.60) computed by the server, never taken from the model. An item without a quoted excerpt or with a
  guessed date can never be "high" (N2, N4).
- Shared prompt rules (`src/lib/ai/prompts.ts`) for Inbox and Meetings: Tamil/Hindi time words (naalaiku, inniku, kal, parson), "kal" and
  "parson" are flagged as unclear, title in English with the quote kept exactly in the original script, ordinary chat gives nothing (N3).
- The Inbox and Meetings review lists show "Sure / Please check / Unclear", "Date unclear", and the language.
- `tests/ai-extraction.test.mts`: Scenarios A, B, D, Tanglish, Tamil script, Hinglish "kal", injection and invalid values. These test the
  checks around the model with fixed replies; they do not measure a model's understanding of Tamil or Hindi (that needs a live evaluation).

## Not done yet (part 2 of Instruction 1)
- `owner_direction` shared / unknown (today: "mine" includes shared work; unknown owner lowers confidence) (N1).
- Opt-in auto-create (default off). Real zero-touch needs the server to analyze new phone messages by itself, without the user's session,
  using the user's own encrypted key. That is a change to how intake and the AI key are used, and gets its own design review next round.
