# Multilingual meetings, Fireflies "Fred", and other note takers (28 November 2026): ChatGPT and Gemini

**Owner:** "Our meetings are multilingual (Tamil, Hindi, English mixed in the same sentence), so Teams/Meet transcripts will not work.
Explain how Fireflies adds its notetaker, what Fred is, and how other note takers work."

## A. Platform transcripts and mixed languages
- **Google Meet, Gemini "Take notes for me":** 8 languages, **one language at a time**, not mixed meetings. Tamil and Hindi are not in
  that list. (Meet's speech *translation* covers Tamil and Hindi, but that is not note-taking.)
- **Teams:** the standard spoken-language list has **Hindi but not Tamil**; changing it changes the transcript for everyone.
  Multilingual speech recognition (Teams Premium or Copilot licence) lets each person pick their language; it is not proven for
  Tanglish/Hinglish inside one sentence. ChatGPT: "partly true, not a blanket rule; measure it."
- **Verdict (both):** the owner is right. ActionBrain needs the **audio** and its own transcription.

## B. Speech models for code-switching
| Model | Where | Note |
|---|---|---|
| Whisper large-v3 (and smaller) | Laptop (GPU helps); phone only small/quantised | Baseline, offline; code-switch quality varies |
| AI4Bharat IndicConformer | Laptop; heavier setup | Open source, 22 Indian languages |
| **Sarvam Saaras V4** | Cloud (user's key) | Advertises Tanglish/Hinglish code-mixing; first cloud candidate (ChatGPT) |
| OpenAI gpt-transcribe | Cloud | Recommended for new work; **gpt-4o-transcribe and whisper-1 shut down 26 February 2027** |
| Deepgram Nova-3 Multilingual, ElevenLabs Scribe, Gemini audio | Cloud | Challengers |
Using a cloud model with the user's own key keeps the owner out, but the provider does hear the audio: say so.
**Before choosing:** a benchmark of 30–50 consented clips with corrected transcripts (Tamil-English, Hindi-English, names, numbers,
interruptions, echo), measuring errors per language and, above all, errors in owner, deadline, negation, amount and commitment.

## C. Official recordings instead of transcripts
- **Teams:** recordings in the organiser's OneDrive (or the channel's SharePoint); Graph can fetch them after the meeting with the right
  permissions (application permissions need an admin and an access policy; some orgs block downloads). Use the user's own sign-in.
- **Meet:** the Meet REST API lists recordings and their Drive file; download with the Drive API. Use the narrow **drive.meet.readonly**
  scope (files made by Meet). It is still a *restricted* scope: Google verification, and a security assessment if a server touches the data.
- Only works when someone records (licences, policies). ChatGPT: a strong primary source when available; Gemini: an optional secondary
  connector.

## D. Desktop helper
Both: keep it; it is the most reliable no-bot path for multilingual calls (WhatsApp, Teams, Meet, Zoom, Slack). Improvements: choice of
speech model, a clear "taking notes" status and a reminder to tell participants (other people don't see a bot), and a watched folder so
recordings from anywhere go through the same pipeline.

## 1. How Fireflies adds its notetaker (fred@fireflies.ai)
Calendar auto-join (Google or Outlook, rules for which meetings) · add **fred@fireflies.ai** as a guest on the invite · "Add to live
meeting" with a link · toggle a meeting in the upcoming list · Chrome extension on Meet ("Add Notetaker") · **Desktop no-bot mode**
(system audio). The bot is a visible participant, may wait in the lobby, can be blocked, and leaves if nobody joins.
Languages: 100+, choose a language or re-transcribe; mixed sentences are not guaranteed.

## 2. Fred (announced 11 November 2026)
Fireflies turned the notetaker into a cross-app AI teammate: meeting notes (bot and no-bot), **Live Assist** (suggestions, answers,
coaching, translation during calls), **AskFred** (questions across meetings and apps, with sources), **Daily briefs and meeting prep**,
**Email assistant** (sort, draft replies and follow-ups), **Slack assistant** (@Fred), **FredBots / AI Skills** (recurring jobs with
approval), **voice agents** (screening, support calls), and artifacts (documents, reports). New: memory across work plus taking the next
action, not just per-meeting notes.

## 3. Other note takers
| Product | Capture | Mixed languages | Price (snapshot) |
|---|---|---|---|
| Otter (OtterPilot) | Calendar bot; app/extension | Mainly English + some; weak on Indic mixing | Free 300 min; Pro ~$8–17/mo |
| Granola | **No bot**, device audio | ~10–17 languages | Free basic; Business $14/user |
| Fathom | Bot; no-bot in beta | Multilingual, not Tanglish-proven | Free; ~$15–16/user |
| tl;dv | Bot; desktop/extension | Language setting; mixing varies | Free; Pro ~$18–29 |
| Read.ai | Bot; desktop | Multilingual | Free tier; ~$15–20 |
| Krisp | Desktop audio, no bot | Several languages | ~$8–16/mo |
| Jamie | Desktop, no bot | Dozens of languages | Free 10 notes; ~$24 |
| Bluedot | Extension/desktop, no bot | Multilingual | Varies |
| Gemini in Meet | Built in | 8 languages, one at a time | Workspace/AI plan |
| Copilot in Teams | Built in | Per-person language with licence | M365 + Copilot/Premium |
"No bot" only means no participant is shown; most still process audio in their cloud. ActionBrain should state its own boundary.

## 4. What ActionBrain should copy (both)
- Several capture routes into **one pipeline**: desktop audio, official recordings, user files, optional self-hosted bot later.
- **Calendar matching**, a daily brief and meeting prep, approval-first follow-ups (draft, user sends), "ask across my commitments".
- Every task cites its transcript evidence. Keep mixed-language quotes as spoken; don't translate before extracting.
- Focus: multilingual **commitment intelligence** with privacy, not the longest feature list.

## Decision
1. **Desktop helper and the phone remain the main capture** (built).
2. **Next build:** a unified audio pipeline with a **choice of speech engine**: local Whisper (default), plus an optional user-key cloud
   engine (Sarvam first, gpt-transcribe as alternative), with the model recorded on each transcript; and a small benchmark set of
   consented Tanglish/Hinglish clips to pick the default.
3. Then official Teams/Meet **recording** import (needs the owner's OAuth apps; Google verification for drive.meet.readonly).
4. A bot only later, optional and self-hosted.

Sources given: Google Meet Help (Gemini notes languages, one language at a time; speech translation); Microsoft Support (Teams spoken
languages, multilingual speech recognition); Microsoft Learn (recording storage, Graph meeting artifacts and permissions, download
blocking); Google for Developers (Meet REST recordings, Drive download, drive.meet.readonly restricted scope) and Workspace Updates;
AI4Bharat; Sarvam (Saaras V4); OpenAI API docs (gpt-transcribe, deprecations); Deepgram; ElevenLabs; Fireflies guide, FAQ and Fred
launch; Granola, Fathom, tl;dv pricing and help pages.
