# Recording calls (private, on-device transcription)

**Meetings → Record a call.** ActionBrain listens through the microphone, turns the speech into text **on your own device** with Whisper, and passes the transcript through the normal meeting analysis: summary, decisions, and suggested tasks and commitments for you to approve.

## Privacy
- The audio is held in memory only and discarded after transcription. **It is never uploaded or saved.** Only the transcript text is stored (in your `meetings` table, protected by Row Level Security, deletable like any meeting).
- The first time, the browser downloads the speech **model files** from Hugging Face and remembers them. The audio does not go there.
- The analysis step (summary and tasks) sends the **transcript text** to the AI provider you chose, using your own key, exactly as pasting a transcript does.

## Consent
Recording laws differ by country and state. Some require every person's agreement. The recorder asks you to confirm that everyone knows and agrees before it will start. That is a reminder, not legal advice.

## What the microphone can and cannot hear
- It hears what is in the room. For a **phone call, turn on speaker** so both sides are picked up.
- It does **not** capture another browser tab's audio (Meet, Zoom, Teams in a browser). With speakers on, the mic will hear them, with some quality loss. A future Chrome-extension feature could record tab audio directly.
- Echo cancellation is deliberately off, because on a speakerphone it can erase the person you are trying to record.
- Recording stops by itself after **60 minutes**, keeping what it has. The page asks before you close the tab mid-recording, and asks the browser to keep the screen on.

## Speed (measured, on one laptop)
Test machine: Windows laptop, 8 CPU threads, 8 GB RAM, Intel integrated graphics (Chrome, production build). Whisper always works on whole 30-second windows, so short clips are not representative.

| Setup | Speed on a full 30 s window | A 30-minute call takes about |
|---|---|---|
| **Tiny, processor** | 3.1–3.7× faster than real time | 10 minutes |
| **Base, processor** (default) | about 1.6× faster than real time | 20 minutes |
| Tiny, graphics card | 0.9–1.4× (slower than the processor here) | 25–35 minutes |
| Small, processor | **not measured**: the test failed with a network error partway through the 238 MB download | unknown |

Practical advice: **Tiny** for clear English and quick turnaround, **Base** for accents and other languages. Phones are slower than a laptop. The graphics-card option is off by default because it was *slower and a three-times-larger download* on this machine. It may be faster on powerful or Apple graphics, which were **not** tested.

Model downloads (one time, then cached): Tiny 39 MB, Base 73 MB, Small 238 MB on the processor. With the graphics card, 114 / 197 / 559 MB.

## How it works
1. `public/recorder-worklet.js` runs in the browser's audio thread and hands over microphone samples in batches.
2. `src/lib/recorder-core.ts` converts them to 16 kHz mono 16-bit audio as they arrive (`src/lib/audio.ts`).
3. When you stop, the recording is cut into ~3-minute pieces **at quiet moments**, not mid-word. Silent pieces are skipped, because Whisper invents phrases for silence.
4. `src/lib/whisper/worker.ts` runs Whisper in a background worker so the page stays responsive.
5. The text goes into a new meeting and is analysed like a pasted transcript.

## Security design
Pages keep the strict Content-Security-Policy. The worker's permissions (run WebAssembly, load its loader through a `blob:` URL, reach `huggingface.co` and `*.hf.co`) are granted **only on the script files under `/_next/static`**, because a worker is governed by the headers on its own script, not its page. `tests/speech-setup.test.mts` fails if the relaxed policy ever leaks onto pages.

The engine (25.6 MB) is copied from `node_modules` into `public/ort` by `scripts/copy-ort.mjs` before every `dev` and `build`. It is not committed. By default the library fetches it from a public CDN, which the policy blocks and which would make recording depend on a third party.

## Gotchas learned while building it
- **Cached security headers.** Static files are cached for a year as "immutable", *including their headers*. If you change the worker policy in `next.config.ts` and the worker file's content does not change, browsers that already have it keep the **old** policy. Symptom: the engine fails to load with a CSP error after you "fixed" the policy. Fix when testing: `fetch(url, { cache: "reload" })` for the affected files, or clear site data. Brand-new visitors are unaffected.
- **`next typegen` and `LayoutProps`** are unrelated, but `npm install` now pulls `onnxruntime-node` (about 290 MB in `node_modules`) because the speech library lists it. It is never used in the browser; it only slows installs.

## What was tested, and what was not
**Tested in a real Chrome, on the production build, with the real policies:**
- The microphone path with a **synthetic voice** (Windows text-to-speech) played through a real audio stream into the real worklet, resampler and Whisper worker: 9 seconds of speech was captured at the right length and loudness, and transcribed correctly except that "Afrose" was heard as "Afros" (Tiny model).
- Both processor and graphics-card paths, and the speed numbers above.
- Unit tests for the audio maths, the recorder's limit, shutdown and microphone-release behaviour (with a fake audio system), the two security policies, and the engine copy step.

**NOT tested. Please try these yourself:**
- A **real microphone** and the browser's permission prompt.
- A **real human voice**, accents, noisy rooms, and a **real phone call on speaker**.
- **Phones and tablets** (speed, memory, screen wake lock). Expect it to be much slower.
- **Long recordings**: the 60-minute limit and memory use were tested only with fakes.
- The new **Record a call panel itself** (it sits behind login). Its pieces were tested, but the assembled screen was not exercised end to end, nor with the AI analysis step.
- Safari and Firefox.
- **Small** model speed (see above).
