# Phone call recordings on Android (free)

**The idea:** your Android phone's *own* call recorder records the call. After the call, you send the recording to ActionBrain with **Share → ActionBrain**. ActionBrain transcribes it **on your phone** (private, free), then suggests tasks and commitments for you to approve.

This follows both platforms' rules. Android does not let apps record call audio, and Google bans apps that try, so the recording is made by the phone's own dialer, which is allowed. ActionBrain only processes the finished file.

## 1. Check that your phone records calls
Most Android phones sold in India have a built-in recorder (Samsung, Xiaomi/Redmi/Poco, Realme, Oppo, Vivo, OnePlus and others), but menus differ by brand and software version, and a few carriers or regions switch it off.
1. Open the **Phone** app, then its **⋮ menu → Settings**.
2. Look for **Call recording**. Turn on **Auto-record** if offered. Some phones only record chosen numbers or unknown numbers.
3. Make a short test call and check that a recording appears (usually in the Phone app's call details, a "Recordings" folder, or a Recorder app).

Things to know:
- **Some phones play a spoken notice** ("this call is being recorded") and some do not. Recording laws differ by country and state; get everyone's agreement. ActionBrain asks you to confirm this before it processes a recording.
- **Format matters.** M4A, MP3, AAC and WAV work. **AMR / 3GP** (an old phone-call format) cannot be read by browsers. If your recorder offers a format setting, choose M4A or MP3. ActionBrain tells you if it cannot read a file.
- **Some recorders capture only your own voice.** ActionBrain warns when a recording is silent.

## 2. Put ActionBrain on the internet (needed once)
`localhost` only exists on your laptop, so your phone cannot reach it. Choose one:
- **Deploy it (recommended, free):** follow `docs/deploy.md` (Vercel + Supabase free tiers). The phone then uses your real `https://…` address, which also lets you *install* the app.
- **A quick temporary test:** run a free tunnel such as Cloudflare Tunnel or ngrok to your laptop's dev server and open its `https://…` address on the phone. Add that address to Supabase → Authentication → URL Configuration. The tunnel stops when you close it.

## 3. Install it and send a recording
1. On your phone, open the `https://…` address in **Chrome**, log in, then menu → **Install app** (or Settings → Install the app inside ActionBrain). Installing is what makes ActionBrain appear in the Share menu.
2. After a call, open the recording in your phone's Recorder, Files or Phone app and tap **Share → ActionBrain**.
3. ActionBrain opens **Meetings** with **"Recording received: …"**. Tick the consent box and tap **Transcribe this recording**.
4. When it finishes, a meeting appears with a summary and suggested tasks and commitments. Approve what you want in **Inbox** and **Commitments**.

You can also skip sharing: **Meetings → Record a call → "Use a call recording from my phone"**, and pick the file.

## Speed and privacy
- Transcription runs **on the phone**. Nothing is uploaded, and the audio is discarded afterwards. Only the transcript text is saved. The first run downloads a speech model once.
- On a laptop, Base took about 20 minutes for a 30-minute call. **A phone will be slower**, probably much slower, and was not measured. Start with the **Tiny** model for speed (names are often misheard) and try Base if accuracy matters. Long calls may be better handled on a laptop (send the file to it).
- Keep the screen on and the page open while it transcribes.

## What is automatic, and what is not
Today: **one tap after the call** (Share). It is not fully automatic, and it needs the phone to be online.

Fully automatic would need something on the phone watching the recordings folder in the background. Options for later:
- A phone automation app (Tasker, MacroDroid) that sends each new recording to ActionBrain. This needs an upload address on the server, plus an access token. It is not built yet. The apps' folder-watching and upload features were not verified.
- A small native Android app. A bigger project.
- Paid cloud call forwarding (a phone number that records), which works on any phone but costs money.

## Not tested: please try these and tell me
- Everything on a **real Android phone**: the Share menu entry, the file picker, memory, speed.
- A **real recording from your phone's recorder**, in its real format, including Hindi or mixed Hindi-English speech.
- Whether your phone records **both sides** of the call.
- Share target availability after installing (this depends on the Chrome version).
Tested on a laptop: the file-reading and transcription path with a WAV file; the share request arriving, being stored, and being picked up once; the recorder panel's accessibility; and the logic with unit tests.
