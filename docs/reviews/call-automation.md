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
