# Calls without remembering (27 November 2026): ChatGPT and Gemini

**Owner's question:** "I receive more than 10 WhatsApp calls a day. Opening the app and typing a recap after each one is manual, and
users will forget. Can a dedicated AI assistant join the call, the way Fireflies is invited to a meeting? My only goal: the user must
not have to remember anything after a call."

## Verdict (both agree)
**A Fireflies-style bot for personal WhatsApp calls is not possible today.** Meta's WhatsApp Business Calling API is for
business-to-customer calls on a business number; there is no official way for any number or app to join an existing personal call or
receive its audio. A business number could take a *separate* call, but that means asking the caller to switch channels and it costs money
per minute (Meta plus the provider). Android also blocks apps from capturing the other side of a VoIP call, and Google Play forbids using
Accessibility for that. Neither reviewer would spend time on a proof of concept.

## What can be zero-touch, ranked
| Channel | Taps after setup | What ActionBrain gets | Decision |
|---|---|---|---|
| Normal (cellular) calls with Samsung auto-recording | 0 | The saved recording file, transcribed on the phone | **Build now** |
| WhatsApp chat messages before and after a call | 0 | The messages (already captured) | **Build "Call follow-through"** |
| Teams meetings with transcription switched on | 0 after the admin allows it | Official transcript via Microsoft Graph | Build next |
| Teams ad hoc 1:1 calls | 0 if a transcript exists | Transcript (some APIs still beta) | Pilot |
| WhatsApp call, one-tap recap notification | 1 tap + speaking | The user's own recap | Keep as a fallback (built in 0.9.0) |
| Speakerphone recording of a WhatsApp call | Manual | Room audio | Not the default |
| WhatsApp Business API "participant bot" | n/a | Nothing (unsupported) | Do not build |

## Design notes
1. **Samsung recording watcher:** watch the audio collection (READ_MEDIA_AUDIO on Android 13+) or a folder the user picks; only the
   Phone app's recordings folder, never all audio. Wait until the file size is stable, deduplicate by file id, transcribe on the phone,
   send only the text through the outbox, and optionally delete the audio after a set time. Prominent disclosure first. Check the real
   folder on the owner's Galaxy before building. Recording laws and Samsung's own "call is recorded" behaviour apply.
2. **Call follow-through (ChatGPT):** when a WhatsApp call ends, look at that chat's messages around the call; tasks come only from
   evidence in the messages. No evidence: a low-confidence "Call with X, details unknown" review item, never an invented task. A one-tap
   "Could you send me the details here?" draft is fine, but **never send AI-written messages to callers automatically** (both reviewers).
3. **Teams:** use Teams' own transcription and Graph "transcript available" notifications, not a live media bot. Live bots need Azure
   Windows servers and admin approval: too costly for a free product; only for an enterprise that pays for it.
4. Android's call-screening role, the assistant role and Live Caption give no call audio. Galaxy AI Call Transcript and Pixel Call Notes
   are not APIs for other apps (and not on the owner's Galaxy A06).
5. **E2EE fit:** recordings and transcripts can stay on the phone; once E2EE ships (see `e2ee.md`) only encrypted tasks leave it.

## Sources (given by the reviewers)
Meta for Developers: WhatsApp Business Platform Calling API and Groups API; Twilio WhatsApp calling pricing; Microsoft Learn: Graph
calling bots (peer-to-peer and group calls), application-hosted media bots (Windows Server in Azure), meeting and ad hoc call transcripts
and recordings (change notifications, VTT, tenant policy off by default); Android Developers: MediaStore and READ_MEDIA_AUDIO, call
screening service, audio capture and sharing rules; Samsung India: Call Transcript Assist; Google Phone app Help: Call Notes.

## Follow-up: a "listener number" that joins the call as a person (same day)
**Owner's idea:** not a bot but a *person*: each user has a second WhatsApp number that ActionBrain controls. When a call comes in, the
user adds that number to the call (it becomes a group call), and "ActionBrain Notes" listens, the way Fireflies joins a Zoom meeting.

**Answers (ChatGPT and Gemini agree):**
- **A Python program with a WhatsApp number = an unofficial client.** Correction to my first answer: some unofficial libraries
  (for example Tryx) *can* join calls and receive audio. But every reverse-engineered client (Baileys, whatsapp-web.js, yowsup, Tryx)
  breaks WhatsApp's Terms (no automated or unauthorised access, no reverse engineering), and those numbers get banned without warning.
  **Do not build.**
- **A second number in the official WhatsApp app is allowed as a normal action** when a human adds it and a human answers. But a
  second Android phone can't capture the audio (Android blocks voice-call playback capture). And **auto-answering by clicking WhatsApp's
  buttons with UI automation counts as automated access: never do it.** ChatGPT: ask Meta in writing before shipping it as a product
  feature; the Terms neither allow nor forbid a note-taking account.
- **A shared ActionBrain listener number for all customers:** ruled out. The owner would hear every customer's calls, and one account
  can't be in many calls at once.
- **What works without breaking anything: a desktop companion with no bot (Option 4).** WhatsApp Desktop on Windows and Mac (and,
  since July 2026, WhatsApp Web) supports calls and group calls. ActionBrain records the computer's sound (Windows WASAPI loopback,
  macOS ScreenCaptureKit) plus the microphone, transcribes on the computer and sends only tasks. Fireflies' own "no-bot desktop capture"
  works the same way and lists WhatsApp. No WhatsApp automation at all.
- **The catch (Gemini):** most of the owner's 10+ calls a day arrive on the phone, away from the laptop. Option 4 takes 3 to 5 actions
  per call, and the listener number 4 to 6. That is more work than the Android paths, not less.
- **Consent:** a visible participant is not enough on its own. Say it at the start ("I'm using ActionBrain to note action items from this
  call, OK?"); stop if anyone objects; keep audio local and short-lived. India: recording your own call is treated differently from
  interception, but the DPDP Act still asks for purpose, transparency and minimum data; California and some others need everyone's consent.

| Approach | Actions per call | Works away from the PC | Risk | Decision |
|---|---|---|---|---|
| Samsung recording watcher (normal calls) | 0 | Yes | Low | Build now |
| WhatsApp chat follow-through | 0 | Yes | Low | Build now |
| One-tap recap after WhatsApp calls | 1 | Yes | Low | Done (0.9.0) |
| Desktop companion, no second number | 1 to 5 | No | Medium (consent) | Optional, later; first a Windows audio test |
| Second listener number, human answers | 4 to 6 | No | Medium to high | Experiment only, ask Meta first |
| Unofficial library, auto-answer, shared number | 0 | n/a | Ban and privacy risk | Do not build |

**ChatGPT's first step for the desktop path:** a local-only Windows test: WASAPI loopback plus a separate microphone stream, a visible
"Capturing call audio" indicator, one 5-minute WhatsApp Desktop call with a consenting person. It passes only if both sides are clear,
with no WhatsApp automation and no upload. Then add Whisper and task extraction.

Sources given: WhatsApp Terms of Service and Help Center (adding people to a call; desktop calls on Windows and Mac; group calls up to 32);
Meta newsroom (WhatsApp Web calling, July 2026); Microsoft Learn (WASAPI loopback recording); Apple Developer (ScreenCaptureKit); Recall.ai
(loopback silence gaps); Fireflies guide (desktop no-bot capture); Supreme Court of India (privacy of phone conversations); DPDP Rules 2025
(e-Gazette).
