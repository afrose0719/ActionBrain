# WhatsApp calls (27 November 2026): what is possible, ChatGPT and Gemini

The owner mostly **receives WhatsApp calls** and asked for the best alternative to recording them. Asked both reviewers with the facts
from the owner's phone (Samsung Galaxy A06, Android 16, India; ActionBrain 0.8.1).

## The four facts (both confirmed)
1. An ordinary app **cannot capture the other side of a WhatsApp call**. Playback capture only covers media, game and unknown audio,
   not voice-call audio; the call audio sources need `CAPTURE_AUDIO_OUTPUT`, which only system apps get. While a call is active, a
   background app recording the microphone may get silence (Android's concurrent-capture rules). (Android developer docs.)
2. Google Play's Accessibility policy says the API "is not designed and cannot be requested for remote call audio recording".
3. Samsung's built-in recorder records **phone (cellular) calls** made in Samsung's Phone app, not WhatsApp calls.
4. WhatsApp has **no API** for a personal account's call audio or transcripts; the Business Calling API is for businesses and gives no
   recordings either.

Also checked: reading Android's **Live Caption** through the assistant long-press is **not** a reliable route. ChatGPT: the assist data
may not include the caption overlay at all. Gemini: Live Caption may be unavailable or English-only on the A06, and it shows only the
last few seconds. (Gemini's device and language claims were not verified here; a test on the phone would settle them.)
ChatGPT's own Accessibility service on the phone is not evidence that the same use would be allowed for ActionBrain: Play reviews each
use case.

## Ranking (both agree)
| Rank | Option | Why |
|---|---|---|
| 1 | **After-call voice recap**: when a WhatsApp call ends, ActionBrain asks "Call with Priya ended (4 min). Anything to remember?"; one tap, speak 5-10 seconds; transcribed on the phone; tasks and Waiting For extracted with the caller's name as context | Works on every phone and in every language, records nothing from the other person, Play-safe |
| 2 | Ask the caller to "send that on WhatsApp" | Already fully automatic (notification capture + zero-touch) |
| 3 | Move planned work calls to Google Meet / Teams with transcripts | Official transcripts, but not for spontaneous calls |
| 4 | Speakerphone + recording the room | Manual, poor audio, needs consent; optional only |

## Build plan for option 1 (both reviewers' details)
- Track WhatsApp / WhatsApp Business ongoing-call notifications (call category) from posted to removed; caller name from the
  notification; ignore calls under 20 seconds and missed or declined calls.
- On call end, show a prompt with "Speak a quick recap" and "Nothing to add" (plus "They will message me", which creates a
  Waiting For item).
- Record only the owner's voice, with a visible mic indicator; transcribe on the phone (Whisper); the caller's name is given to the AI
  so "she will send..." resolves to that person; the same confidence and auto-create rules apply.
- Treat call duration and caller identity as best-effort until tested on the A06 across incoming, missed, declined and interrupted calls.
- Note: the prompt is a phone notification, so Android 13+ needs the **notification permission** with its own explanation first.
