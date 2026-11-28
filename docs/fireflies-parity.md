# Fireflies features compared with ActionBrain (28 November 2026)

Read from fireflies.ai (home page and /notetaker). Fireflies' assistant is now called "Fred". ActionBrain is open source and free, with
the customer's own AI key, so anything that needs paid servers to hear audio (a bot joining calls, live media) is designed differently:
**audio is captured and transcribed on the customer's own device; nobody joins the call.**

| Fireflies feature | What it does | ActionBrain | Status |
|---|---|---|---|
| **Bot** auto-joins calendar meetings | A participant records Zoom/Meet/Teams | **ActionBrain Notetaker** with the customer's own Vexa (hosted ~$0.30/h on their account, or self-hosted): send to a link now, or auto-join from Google Calendar; speaker-labelled transcript becomes notes | Done (M37) |
| **Desktop app, no bot** (Zoom, Meet, Teams, Slack Huddles) | Records the computer's sound | **Call Notes helper**: WhatsApp, Teams, Zoom, Slack, and browser calls (Google Meet, WhatsApp Web) | Done (M34, M35) |
| **Chrome extension** (Meet without a bot, live transcript) | Captures the Meet tab | Laptop recorder "On this computer" (M33); helper covers Meet automatically | Done; live transcript: later |
| **Mobile app** (in-person) | Records on the phone | Phone recorder + Android share sheet + after-call recap | Done |
| **Audio/video upload** | MP3/MP4/WAV/M4A | "Use a call recording" | Done |
| **Dialers / API** | Aircall, RingCentral | Not planned (paid dialers) | Not planned |
| Transcription, 100+ languages, auto-detect | | Whisper on the device, or the customer's own **Sarvam (Tamil/Hindi code-mix)** or OpenAI key; bot detects language per speaker turn | Done (M36) |
| **Speaker labels** | Who said what | Notetaker bot: real names from the meeting. Desktop: You/Others possible | Bot done; desktop next |
| **Summary, decisions, action items** | | Meeting analysis: summary, decisions, tasks, commitments with quotes | Done |
| Expandable summaries (see what was said) | | Each task and commitment keeps its exact quote | Done |
| Custom notes | Tailored summaries | Later (a per-user prompt add-on) | Later |
| **Generate follow-ups** | Follow-up email after a meeting | "Draft follow-up email" on each analysed meeting | Done (M35) |
| **Meeting search / AskFred** | Search and ask across meetings | Search page + command box | Done (ask-across-meetings: later) |
| **Daily brief / meeting prep** | Brief and prep before each meeting | Waiting-for briefing exists; prep from past meetings with the same people | Next |
| **Tasks** to Asana/Jira/Trello | | Tasks inside ActionBrain; export | Partly |
| **Official transcripts** | | Teams (Graph, delegated, admin consent) and Google Meet (Meet REST API, Workspace) imported after the meeting | Next (needs the owner's OAuth apps) |
| Talk-time, sentiment, topics | Conversation intelligence | Needs speaker labels first | Later |
| Soundbites, comments, bookmarks, channels, user groups | Team features | Later | Later |
| CRM / ATS sync, MCP server | | Not planned for now | Not planned |
| Live Assist (real-time suggestions in the call) | | Needs live transcription on the device | Later |
| Voice agents (takes calls for you) | | Not planned | Not planned |
| Security: no training on data, SOC 2, private storage | | Open source, BYOK, audio never uploaded, E2EE planned (`docs/reviews/e2ee.md`) | In progress |
