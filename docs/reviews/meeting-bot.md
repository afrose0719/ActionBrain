# A Fireflies-style meeting bot for Teams and Google users (28 November 2026): ChatGPT and Gemini

**Owner:** "Users who can't invite a bot use the desktop recording. Users who have Teams / Google Workspace access should get a bot that
is added automatically and listens and takes notes, the way Fireflies does."

## How Fireflies' bot works (both)
Connect a calendar → pick meetings by the user's rules → at start time a worker joins the meeting link as a visible participant
("Fireflies.ai Notetaker") → waits in the lobby until admitted → captures audio (or the platform transcript) → leaves → delivers notes.
Fireflies' help page lists three ways in: auto-join by settings, adding it to the calendar invite, or adding it to a live meeting.
Technically this is a fleet of per-meeting workers: a full Chrome per meeting for Google Meet (no official live media API), a Graph
calling bot or browser for Teams, the Meeting SDK for Zoom. **Calendar access does not guarantee admission:** lobbies, guest rules and
admin policies can block or delay the bot.

## Official routes today
| Platform | After the meeting (no bot) | Live bot | Verdict |
|---|---|---|---|
| Google Meet | **Meet REST API**: conference records, transcripts, transcript entries, recordings, smart notes; event subscriptions | **Meet Media API discontinued** (new sign-ups closed; endpoints shut down 15 January 2027). Only browser bots remain | Pull the official transcript; drop the Media API from the roadmap |
| Microsoft Teams | **Graph transcripts** (VTT) for scheduled meetings and some ad hoc calls; no longer metered since 25 August 2025. Tenant admin must turn Graph transcript access on (off by default); permissions need admin consent | Application-hosted media bot: C#/.NET, Windows Server on Azure. Teams admins can detect, require approval for, or block external bots (default: lobby) | Pull the official transcript; media bot only for paying enterprises |
| Zoom | Cloud recording/transcript when enabled | **RTMS** (official live media, no participant bot, needs credits) or Meeting SDK bot. Zoom actively blocks unofficial automated clients | Transcript import; RTMS optional |

## Build options and cost
| Option | Cost per meeting-hour | Ops | Policy risk |
|---|---|---|---|
| Official transcript import | ~$0 | Low | Lowest |
| Self-hosted open-source bot (Vexa, Apache-2.0; Attendee, Django + Chrome) | Own servers: 1–2 GB RAM per meeting + speech-to-text | High: breaks on UI changes, lobbies | Moderate to high |
| Paid bot API: Recall.ai $0.50 + $0.15 transcription; Meeting BaaS from $0.35; Vexa hosted $0.30 + $0.20 | $0.35–$0.65 | Low | Provider and platform rules |

ChatGPT's example: 100 customers × 10 meeting-hours a month = **$500–$650 a month** for a paid bot API alone. Not compatible with
"free for everyone" unless sponsored, limited, or self-hosted by the customer.

## Privacy (owner must not see customer content)
- A bot run by ActionBrain **hears the audio**. Sealing the transcript to the user's public key helps, but the audio is still plain inside
  the bot; honest wording would be "encrypted transcript delivery", not "the owner can't access anything".
- **Best fit (both):** the transcript is made by the customer's own Workspace/M365; the customer's own device fetches it, encrypts it with
  their vault key and runs the extraction. Avoid keeping broad refresh tokens on ActionBrain's server.
- A bot only as **customer-hosted** (Docker on their own VM) or a clearly separate, disclosed opt-in service.

## Consent
A visible bot is not consent on its own. Google Meet and Teams admins can require participants to agree before recording/transcription;
Zoom has consent prompts. ActionBrain must: use a clear bot name ("ActionBrain Meeting Notes"), post a notice, join only meetings the
user switched on, respect lobby refusal and "stop", never upload raw audio, and offer deletion. India: don't assume being a participant
makes recording lawful; get consent where required.

## Decision (both agree)
1. **Teams and Google Meet transcript connectors** (official, zero-touch, ~$0): match a calendar event to its finished transcript, fetch it
   with the customer's permission, extract tasks and commitments, dedupe with stable event IDs.
2. **Desktop Call Notes helper** for everything else (WhatsApp, Zoom, Slack, meetings with no transcript). Built (M34, M35).
3. **No transcript and no helper:** a calendar-only "follow-up may be missing" reminder; never invent content.
4. **Optional later:** Zoom RTMS; a customer-hosted Vexa bot adapter; Teams media bot for enterprises; paid bot API only as a sponsored or
   paid add-on.
**Do not start with a universal bot.** Next build step: the post-meeting transcript slice (Google Meet REST + Teams Graph). It needs the
owner's Google and Microsoft OAuth apps on Vercel, and the customer's admin to allow transcript access.

Sources given: Fireflies help (ways to add the notetaker); Google for Developers (Meet REST API conference records and transcripts,
Meet Media API discontinuation); Google Meet Help (transcripts, consent controls); Microsoft Learn (Graph transcripts and recordings,
metering change, tenant policy, application-hosted media bots, external bot detection/approval, recording consent); Zoom Developer Docs
(RTMS, Meeting SDK) and Zoom Support (unofficial bot blocking); Vexa and Attendee GitHub; Recall.ai, Meeting BaaS and Vexa pricing pages;
Gladia (how meeting bots work).
