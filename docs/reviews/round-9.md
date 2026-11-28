# Round 9 (28 November 2026): build review of M33–M37, and "should ActionBrain run its own bot?" (ChatGPT and Gemini)

Shared: laptop recorder (M33), Windows Call Notes helper (M34/M35), follow-up drafts (M35), speech engine choice (M36), notetaker bot
with the customer's own Vexa (M37); 451 tests. Not yet tested live: a real Vexa bot, the helper on a real call.

## Verdict
Big step forward, **not production-ready yet**. The remaining risks are trust boundaries and real-world behaviour, not test coverage.

## Findings (both unless marked)
1. **Keys in localStorage** (Sarvam, OpenAI, Vexa): one XSS reads them all (OWASP). Fix: strict CSP (no inline/eval), never log keys;
   in the helper use Windows Credential Manager/DPAPI; in the browser prefer session-only keys. Encrypting with a key the same page can
   read does not stop XSS (ChatGPT). Vexa key controls bots: allow revoke/delete.
2. **Vexa relay** `/api/notetaker`: the transcript passes through our server in plain text, so it is "no storage", not owner-blind.
   ChatGPT: allowlist the exact Vexa host instead of any https host (DNS rebinding, ports), strict schemas, reject unknown fields,
   per-user rate limits and byte limits, no raw upstream errors, no logging of bodies/keys. Better: let the device or a customer-hosted
   proxy talk to Vexa. **Keep polling on the device**, not server-side (both).
3. **Vexa retention (ChatGPT, important):** hosted Vexa stores meeting audio by default unless `recording_enabled: false` is sent;
   transcripts kept until deleted; its pages disagree on deletion. Send `recording_enabled: false`; disclose Vexa as a separate processor.
4. **Helper consent and visibility:** a hidden window recording with no picker can look like covert recording. Need: a persistent
   "recording" indicator in the tray, one-click stop, a capture history, per-app auto-capture off until switched on, call it a
   "possible call" (the registry is a trigger, not proof). **Teams can detect third-party recorders and notify participants** (ChatGPT).
5. **Registry polling:** heuristic, can change with Windows updates; adaptive interval (2 s when active, 5 s idle) (Gemini).
6. **Electron hardening:** CSP, exact-origin checks, validate IPC sender frames, deny unused permissions, Electron **fuses** (RunAsNode,
   NODE_OPTIONS, inspect, asar integrity), signed updates only.
7. **What breaks first:** Teams lobby (external bots default to "require approval"), Meet guest/bot restrictions, Windows ducking and
   Bluetooth device changes, 2-hour meetings (memory, WASM), laptop sleep (stale "joining"/"recording" states), false triggers (voice
   notes, dictation). Treat "bot sent" and "bot admitted" as different states; never say "captured" until text arrives.
8. **Distribution:** EV certificates no longer skip SmartScreen. ChatGPT: **Microsoft Store MSIX first** (Microsoft signs it, trusted
   updates), then a signed GitHub release, then winget. Gemini: SignPath.io gives free signing to qualifying open-source projects.
   Microsoft Artifact Signing may not be available in India. Keep the ZIP for developers only.
9. **Policy wording:** don't claim "the owner cannot see customer content" yet. List each path separately: local, cloud speech (direct to
   provider), Vexa (its own processor and retention), our relay (transcript passes through), helper (reads which app uses the mic, not
   audio, until capture starts), consent, deletion. Update /privacy, PRIVACY_DATA_MAP.md, STORE_LISTING.md, Play Data safety.

## Top 5 fixes
| # | ChatGPT | Gemini |
|---|---|---|
| 1 | Recording consent and visibility (indicator, stop, history, opt-in per app) | Harden the relay and Electron boundaries |
| 2 | Keys out of localStorage | Fix the installer, checksums, signing |
| 3 | Relay redesign (fixed Vexa host, no transcript through us, `recording_enabled:false`) | Sleep/wake, device change, long meetings |
| 4 | Electron hardening (fuses, CSP, IPC) | Adaptive polling + recording indicator |
| 5 | Signed release + real-call test matrix | /privacy, data map, store docs |
**Next feature (ChatGPT): "Capture health and recovery"**: one card per session showing app, consent, audio meters, bot states
(sent → lobby → admitted → receiving → transcript ready), checkpoints that survive a crash or sleep, and an "audio missing" warning.

## Owner's question: ActionBrain's own bot, paid, e.g. 30 free minutes a day
- **Possible, and no conflict with open source**: Apache-2.0 allows selling a hosted service; the code stays free (GitLab, Supabase,
  n8n, Cal.com, Vexa itself). Keep Vexa's licence/NOTICE; don't imply Vexa endorses it.
- **Options:** self-host Vexa as "ActionBrain Notetaker" (2–6 engineer-weeks); write our own bot (3–6+ months, highest upkeep); a paid
  API (Recall.ai $0.50/h + $0.15 transcription; Meeting BaaS from $0.35/h; Vexa hosted $0.30 + $0.20) behind our billing (1–3 weeks).
- **Costs:** ~2 vCPU/2–4 GB per concurrent bot (Hetzner CPX22 ~$23/month, DigitalOcean $24); transcription: Sarvam ₹0.49/min
  (₹29.40/h), OpenAI ~₹0.43/min, Deepgram ~₹0.50/min, self-hosted Whisper on a busy GPU very cheap but idle GPU time costs.
  Self-hosted with Sarvam ≈ **$0.37–0.40 per meeting-hour**.
- **30 free minutes/day = 15 hours/user/month — not sustainable**: at $0.50/h that is $750/month for 100 users, $7,500 for 1,000,
  $75,000 for 10,000. **Use 300 free minutes/month (like Otter)**: $250 / $2,500 / $25,000.
- **Prices:** Fireflies $10–18, Otter $8.33–16.99, Fathom $16–20, tl;dv $18, Read.ai $15–19.75 per user/month. India: ₹299–₹599/month.
  ChatGPT warns ₹299 with 10 bot hours loses money at list prices; start at **₹299 with ~3 hosted hours + top-ups**. Razorpay (2% +
  GST on the fee) for web; **Google Play Billing required inside the Play app** (15% subscription fee; India alternative billing has its
  own rules); **18% GST** on subscriptions (confirm with a CA).
- **Privacy:** a hosted bot means our server hears live audio. Honest claims: no raw audio kept, transcript encrypted to the user's key,
  logs without content. Not honest: "ActionBrain cannot access meeting content at all". Offer two named modes: **Private** (desktop
  helper, bring-your-own Vexa/keys; free) and **Hosted Notetaker** (paid convenience, clearly disclosed).
- **Recommendation:** ChatGPT: yes, but start with a **paid-API beta** and a parallel self-hosted Vexa load test (1/2/4/8 bots), then
  launch with 300 free minutes/month. Gemini: **not yet**: first live-test and harden what shipped, then add a hosted tier if users ask.

Sources given: OWASP cheat sheets; Electron security checklist, fuses, setDisplayMediaRequestHandler; Microsoft Learn (SmartScreen,
code signing, Artifact Signing eligibility, MSIX/Store, winget manifests, Teams external bot and third-party recording detection);
Microsoft Support (microphone indicator); Vexa pricing, privacy and security pages; Recall.ai and Meeting BaaS pricing; Hetzner,
DigitalOcean, Fly.io, Oracle pricing; Sarvam pricing; RunPod Whisper benchmarks; Otter, Fireflies, Fathom, tl;dv, Read.ai pricing;
Razorpay and Stripe India fees; Play Console payments policy and India alternative billing; CBIC GST; Apache Software Foundation
licence FAQ; GitLab handbook; Chrome Web Store program policies.

## Done after round 9 (28 November 2026)
- **Bug found while fixing:** the site's security policy only allowed connections to itself and Supabase, so the browser **blocked the
  Sarvam/OpenAI speech engines** from M36. `connect-src` now includes `https://api.sarvam.ai` and `https://api.openai.com`.
- **Vexa:** every bot request sends `recording_enabled: false` (no meeting audio kept by Vexa).
- **Relay** `/api/notetaker`: per-user limit (30 a minute), self-hosted addresses must resolve only to public IPs (blocks DNS tricks
  to internal networks), port 443 only, platform checked, replies cut to the fields the page uses, upstream error text never echoed.
- **Windows helper talks to Vexa directly** (IPC to the main process; no CORS there): transcripts never pass through ActionBrain's
  server, and a Vexa on the same computer (`http://localhost`) works. Checked live: a fake key reached Vexa and got 401; an internal
  address and an unknown action were refused.
- **Keys** (Sarvam, OpenAI, Vexa): kept only until the browser closes unless "Remember on this device" is ticked; never inside the
  settings object; old saved keys moved once. (Strict CSP already: no inline HTML insertion, no eval in production.)
- **Helper 0.2.0:** an always-on-top "Taking notes: X call [Stop] [Skip]" bar, a red tray icon, "Stop and keep the notes" and "Skip
  this call" in the tray, "Recent calls" (app, time, length, outcome; never content), wording "seems to have started", sleep finishes
  the recording and wake starts fresh, checks every 2 s during a call and 4 s otherwise, Electron fuses (RunAsNode, NODE_OPTIONS,
  inspect arguments off; asar integrity and asar-only on; cookie encryption on).
- **Privacy page** now describes each path separately, including that browser notetaker transcripts pass through our server and that
  Teams may tell participants a recorder is running.
- **Signing is now a must, not a nice-to-have:** on this Windows 11 laptop **Smart App Control blocked every new unsigned build**
  ("An Application Control policy has blocked this file"), with or without fuses. Customers with Smart App Control on cannot run the
  ZIP. Next: Microsoft Store (MSIX, signed by Microsoft) or SignPath's free open-source signing. Owner action needed.
- 458 tests pass (7 new). Still not tested live: a real meeting with the bot; the helper on a real call; the recording bar on screen.
