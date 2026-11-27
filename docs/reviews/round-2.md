# Review round 2 (27 November 2026): every instruction, nothing dropped

Inputs: ChatGPT and Gemini replies to the round-2 build (PR #1, `ecd909b`), plus the requirements the owner raised directly in both chats
(Zero-Touch, Accessibility, WhatsApp/Teams calls, Personal + Work, simpler UI). Both reviewers again said they **could not open the GitHub code**,
so their reviews rest on the written summary.

Status: ✅ done in this round · 🟡 partly · ⏳ planned · ❌ declined (with the reason)

## A. Corrections to round 2 (both reviewers)
| # | Instruction | From | Status |
|---|---|---|---|
| A1 | Data safety: the audio answer must be path by path (on-device Whisper vs the browser speech service) | ChatGPT, Gemini | ✅ `docs/store-release.md` "Audio, path by path" |
| A2 | Notification text = Messages → Other in-app messages, collected (it leaves the phone) | ChatGPT, Gemini | ✅ already in the draft |
| A3 | Privacy policy: what happens on revoke/disconnect, retention of queued/failed events | ChatGPT | ✅ `/privacy` "Disconnect a phone", "Retry records" |
| A4 | Keep Google API Limited Use separate from the Chrome Web Store statement; claim it only for scopes really used | Gemini | ✅ two sections; names the one scope (Calendar read-only) |
| A5 | Notification disclosure must name every source (Teams too) | Gemini | ✅ already: "for example WhatsApp or Microsoft Teams" |
| A6 | Set `NEXT_PUBLIC_PRIVACY_CONTACT` in production | Gemini | ⏳ owner action on Vercel |
| A7 | Test both disclosures on a real phone; record the screen for Play Console | ChatGPT, Gemini | ⏳ owner + phone |
| A8 | Signed release build, Play internal testing, Data safety filled from the real build | ChatGPT | ⏳ |

## B. Next instructions, in the order both agreed
| # | Instruction | From | Status |
|---|---|---|---|
| B1 | Revoke / rotate a phone token from the web; revoked token → 401 | both | ✅ **already existed** (Settings → Phone messages → Turn off / New token; the row is deleted or the hash replaced, so the old token returns 401). `last_received_at` is already shown. |
| B2 | Byte-size payload caps → 413, on intake **and** analyze | both | ✅ new `src/lib/body.ts`: every API route reads its body through a streamed byte limit (16 / 64 / 256 KB); a lying Content-Length or endless stream is cut off. Intake kept its 8,000-character rule on top. |
| B3 | `client_event_id`: a retried message is answered "duplicate" and stored once | both | ✅ Milestone 28 SQL + `x-actionbrain-event-id` header. The id is remembered only when the message was stored, so a message refused by the daily limit can be retried. ⏳ The Android app does not send it yet (comes with B5). |
| B4 | AI output: confidence, language, owner direction, counterparty, due date, waiting-for vs task; opt-in auto-create (default **off**); review for medium, clarify for low | both | ⏳ next round |
| B5 | Android encrypted offline queue (Room + WorkManager, Keystore key), sends `client_event_id`; revoked token while offline → queue not uploaded | both | ⏳ |
| B6 | Multilingual test set: English, Tamil, Hindi, Malayalam, Telugu, Kannada, Tanglish/Hinglish; relative dates ("naalaiku", "kal") | both | ⏳ with B4 |
| B7 | Rate limit per token | ChatGPT | ✅ effectively: one token per user, 300 messages/day per user in the database |
| B8 | ZIP limits (entry count, expanded size) | ChatGPT | ❌ not applicable: there is no ZIP import (my round-1 summary wrongly said ".zip"; only `.txt` exports are read). |

## C. Gemini's Zero-Touch blueprint (5 instructions + 6 tests)
| # | Instruction | Status / position |
|---|---|---|
| C1 | Automatic pipeline: normalize → detect language → one LLM extraction → dedupe → score and route → schedule reminders, replacing the manual Analyze button | ⏳ after B4 |
| C2 | Cross-channel dedupe (same promise on WhatsApp and email → one task, `source_event_ids[]`) | ⏳ |
| C3 | Android: read full `MessagingStyle` bundles; 500-entry local hash cache; Sources & capture status screen; per-app toggles; offline queue | 🟡 per-app toggles, pause tile, status already exist; rest ⏳ |
| C4 | Call intelligence: call-state detection, post-call "10-second voice recap" prompt, opt-in OEM call-recording folder watcher, honest capability status (`metadata_only` / `oem_recording_file`) | ⏳ |
| C5 | Microsoft Graph delta sync (Outlook mail, Teams chats, calendar) + 5-minute cron; Google Calendar incremental sync | ⏳ |
| C6 | Gmail without CASA: user-owned Google Apps Script that posts new mail to `/api/intake`, or bring-your-own Google OAuth client | ⏳ good idea, agreed |
| C7 | Reminder engine: T-24h / T-2h / overdue, waiting-for follow-up after 48 business hours, quiet hours, unblocked notification | ⏳ |
| C8 | Tests A–F: WhatsApp action item, email deadline, cross-channel dedupe, waiting-for, multi-owner meeting, call-capability honesty | ⏳ with C1–C4 |

## D. Owner's requirements raised in the chats
| # | Requirement | Status |
|---|---|---|
| D1 | Zero-touch: no manual sharing, exporting or Analyze as the normal flow | ⏳ C1, B4 |
| D2 | Accessibility capture stays in the product (read-only, user-enabled), and should be considered for the Play build | ⏳ see "Disagreements" 3 |
| D3 | WhatsApp and Teams call intelligence | ⏳ C4; must be proven on real phones |
| D4 | Personal and Work spaces, a Today view, easy re-classification | ⏳ |
| D5 | Modern, simple, mobile-first UI: Today · Work · Personal · Waiting For · Settings; dark mode | ⏳ |
| D6 | Free Outlook.com users must work (no paid Microsoft 365 required) | ⏳ Graph `Mail.Read` works for personal accounts; Teams chat API does not (work/school only) |

## Disagreements (where I think a reviewer is wrong, with the reason)
1. **"`zero_touch_enabled` default true once a key is saved"** (Gemini, Zero-Touch reply). I disagree: both reviewers' own round-2 instructions say auto-create must be **opt-in, default off**, and turning on automatic writes from untrusted messages by default weakens the prompt-injection defence. Proposal: default off, one clear switch during onboarding.
2. **`READ_CALL_LOG` for call detection** (Gemini). Google Play restricts Call Log permissions to apps whose core function needs them (default dialer and similar); a task app would likely be refused. Call **state** (`TelephonyCallback`) needs only `READ_PHONE_STATE`, and the contact name can come from the notification instead.
3. **Accessibility in the Play build.** ChatGPT says it is allowed with a declaration, disclosure and consent, but not for autonomous action. Gemini says it is a guaranteed rejection. My view: the policy allows non-accessibility tools to declare it, but reading other people's chat messages is exactly the "sensitive data" case reviewers look at hardest. Plan: keep it out of the first Play submission (ship notifications first), then submit the declaration with the read-only, user-enabled design and a video as a separate update, so a rejection cannot block the whole app.
4. **CASA cost "$500–$4,500/year"** (Gemini). Not from an official page; not repeated. The official fact is only that restricted Gmail scopes need verification and a security assessment.
5. **Teams meeting transcripts with `OnlineMeetingTranscript.Read.All`** (Gemini). That permission needs tenant admin consent, so it is not zero-touch for most users; keep it optional.

## Official sources
See `docs/store-release.md`. Added this round: Google Play Data safety (https://support.google.com/googleplay/android-developer/answer/10787469).
