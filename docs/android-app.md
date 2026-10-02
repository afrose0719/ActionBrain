# The ActionBrain Android app (Milestone 23)

A small native Android app (Kotlin, no libraries) that shows your ActionBrain website in a window and adds the phone abilities a website cannot have by itself. It replaces any third-party automation app for WhatsApp messages.

## What it does
- **Opens your ActionBrain website** (and only that one site). You log in once; the login stays.
- **Forwards WhatsApp messages to your Inbox.** It reads WhatsApp's notifications (only WhatsApp and WhatsApp Business) after **you** switch on Notification access for ActionBrain. Group chats are recognised reliably, using the group flag Android attaches to the notification.
- **Gets its token from the website.** In **Settings → Phone messages**, press **Create my private link** inside the app. The page hands the token to the app, which keeps it encrypted in Android's Keystore. Nothing to copy or paste.
- **Share to ActionBrain.** Share text from any app that has a Share button and choose ActionBrain: it opens the Inbox with the text filled in. **WhatsApp chat export:** in a chat, ⋮ → More → **Export chat** → **Without media** → ActionBrain. The Inbox opens with the whole conversation loaded (who said what, with times), ready for **Add & analyze**. (WhatsApp itself offers only Copy and Forward on single text messages, so Share works for an exported chat, not for one message.)
- **Microphone and file pickers work inside it** (Record a call, Use a call recording, Import chat). The microphone is asked for only when you press Record.
- Shows its own status in Settings: connected, notification access on/off, messages sent and failed.
- **You choose what is captured** (notifications, chat reading Automatic / On tap / Off, pause) and can add a **Quick Settings tile**. See "Choosing what to capture" below.

## What it cannot do (Android's rules, not a gap in the app)
- It **cannot hear phone calls**. Android does not give ordinary apps both sides of a cellular call. (Call detection and your phone's own call recordings are the planned next step, Milestone 24.)
- It sees only the notification **preview**: very long messages arrive cut off, and a message you read before the notification appeared will not be seen.
- There is **no offline queue**: if the phone has no internet for about 12 seconds after a message, that message is counted as failed and is not retried later.
- **While you are looking at a chat, WhatsApp posts no notification for it**, so messages that arrive during a live conversation are not captured by this method. Export the chat afterwards (see above), or turn on **Live chat reading** (below).
- Android shows the **latest** message of a notification. If several arrive within a fraction of a second, an earlier one can be missed.

## Permissions
Only **Internet** and **Microphone** (asked at the moment you press Record). It does **not** ask for call log, phone state, SMS, contacts, location or storage. A test (`tests/android-bridge.test.mts`) fails if that ever changes. Notification access is not an install-time permission: Android makes you switch it on yourself in Settings, and you can switch it off there at any time.

## Install on your phone
The app is a file (`app-debug.apk`), not a Play Store app. It is for your own use.
1. Build it (below), or get the APK from whoever built it.
2. **With a USB cable** (what I used): on the phone, Settings → About phone → tap **Build number** 7 times, then Developer options → **USB debugging** on. Connect, accept the prompt, then on the PC:
   `adb install -r android/app/build/outputs/apk/full/debug/app-full-debug.apk`
   Some brands (for example Xiaomi) have an **"Install via USB"** switch in Developer options; Samsung does not. On Samsung the usual blockers are **Auto Blocker** and **Google Play Protect** (see below). Keep the phone **unlocked and awake** during the install (Developer options → **Stay awake**), because a locked or sleeping phone can make `adb` stall.
3. **Or copy the file to the phone** and open it. Allow "Install unknown apps" for that file manager when asked.
4. Samsung's **Auto Blocker** (Settings → Security and privacy) blocks installs from outside the store and from USB. If the install fails or never finishes, switch it off temporarily.

## First run
1. Open ActionBrain, log in.
2. **Settings → Phone messages (WhatsApp)** → tick the box → **Create my private link**. The status box under it should say "Connected to your ActionBrain".
3. Press **Allow notification access** and switch **ActionBrain** on.
   - Android 13+ may grey it out for an app installed from a file. Press **App settings** → ⋮ (top right) → **Allow restricted settings**, then try again.
4. Press **Battery settings** and set ActionBrain to **Unrestricted** (Samsung: Settings → Apps → ActionBrain → Battery). Otherwise the phone may stop it in the background.
5. In **Settings → Phone messages**, set the filters (ignore groups, and/or list the people you want). Have a friend send you a WhatsApp message. It appears in **Inbox** within seconds.

## Build it yourself
Needs: Java 17+ (JDK 21 works), the Android SDK (platform 36, build-tools 36.0.0, platform-tools), and Gradle 9.8 (the repo has the wrapper).
```bash
cd android
echo "sdk.dir=C:/path/to/Android/Sdk" > local.properties      # forward slashes, even on Windows
./gradlew testFullDebugUnitTest assembleFullDebug assemblePlayDebug
#   full: app/build/outputs/apk/full/debug/app-full-debug.apk  (with live chat reading, for your own phone)
#   play: app/build/outputs/apk/play/debug/app-play-debug.apk  (without it, for the Play Store)
./gradlew assembleFullDebug -PactionbrainUrl=https://your-site.vercel.app   # point it at your own deployment
```
The app opens `actionbrainUrl` (default: the deployed site) and refuses to build with anything that is not `https://`.

**Windows note:** Gradle downloads its own copy of `aapt2.exe`, which Windows "Application Control" or Smart App Control may block. Use the Google-signed one from the SDK instead, in your **user** Gradle file (`~/.gradle/gradle.properties`):
`android.aapt2FromMavenOverride=C:/path/to/Android/Sdk/build-tools/36.0.0/aapt2.exe`

## Live chat reading (optional, "full" build only)
**The problem it solves.** While you are looking at a WhatsApp chat, WhatsApp posts no notification for it, so the notification method never sees a conversation you are in the middle of. Live chat reading reads the open chat's messages from the screen and sends the new ones to your Inbox, **including your own** ("I'll send it tomorrow"), marked as yours.

**How it works.** It is an Android **Accessibility service**, switched on by you in Android Settings → Accessibility after you agree in the app's own dialog (Settings → Phone messages → *Turn on live chat reading*).
- Android only delivers events from WhatsApp and WhatsApp Business (`res/xml/screen_service_config.xml`), and the code checks again.
- **Read-only.** It has no permission to click, type, swipe or take screenshots (a test fails if that changes).
- The only text it ever copies is the **chat name, message text, and a group member's name**. Never the box you type in, never another app.
- It sends **only new messages**: what was on screen when you opened the chat, and older messages you scroll back to, are never sent. A message is sent at most once per chat session (so an identical "ok" repeated later in the same chat is not sent again).
- Your own messages go in as `You (to Rajesh): ...`, so the AI knows the promise is yours.
- Nothing is stored on the phone. A few short keys stay in memory to avoid sending the same message twice.
- **Settings → Phone messages → Show what the app sees** shows the *shape* of WhatsApp's screen (names, positions, text lengths, **no message text**). If reading does not work, send me that and nothing private goes with it.

**Two builds.** `full` contains this service (for your own phone). `play` does not, so it can go to the Play Store while Google reviews the declaration. Same app, one switch (`SCREEN_READING` in `app/build.gradle.kts`).

**Google Play.** The Play policy for the Accessibility API (read from Google's policy page; re-check it in Play Console before you submit) says an app that is not a disability tool may use it only with:
- a **prominent in-app disclosure and explicit consent**, which cannot rely on the privacy policy alone. This app shows its own dialog before Android's settings open;
- the **Permission Declaration Form, with Google's approval**;
- **no autonomous actions** on the device. This service only reads, and you approve every task, but whether Google sees it that way is **their decision**. "Trusted app" is not an exemption, and a misleading or undeclared use can get the app or developer account suspended.
Plan: submit the `play` build first (notifications and chat export), then add the declaration for `full`'s service when you are ready.

**What can go wrong (tested only with unit tests, not on your phone yet):**
- It finds WhatsApp's screen parts by their internal names (`conversation_contact_name`, `message_text`, `name_in_group`). WhatsApp can rename them in an update. If it does, the service finds nothing and **sends nothing**; it never guesses.
- Telling *your* messages from other people's uses where the text sits on screen (right edge = you). That is a rule of thumb and can be wrong for very long messages. The thresholds are the first thing to tune on a real phone.
- Group member names are read from the same message row. If WhatsApp changes the layout, the sender becomes "Unknown", never another member's name.

## Choosing what to capture (Milestone 25)
**Settings → Phone messages → This phone → What to capture** has three independent controls. Everything is optional.

| Control | Choices | Effect |
|---|---|---|
| **Notifications** | On / Off | Messages that arrive while you are **not** looking at that chat |
| **Chat reading** (full build) | **Automatic** / **On tap** / **Off** | Messages in a chat you have **open** |
| **Pause** | 1 hour / 8 hours / Resume | Switches **both** off for a while. Your choices are kept and come back when it ends. |

These switches change only what ActionBrain does. Android's own permissions (notification access, Accessibility) stay as they are; remove them in Android Settings if you want them gone.

**On tap (the floating button).**
- A round **A** button appears at the screen edge **only while a WhatsApp chat is on screen**, and only in On tap mode.
- **Tap it:** everything visible in the chat is sent to your Inbox, except what was already sent. A short message tells you how many ("✓ 5 messages captured", or "Nothing new to capture"). Older messages you scroll back to count: pressing the button is a deliberate "take what I can see".
- **Drag it** to move it (it remembers where). **Long-press it** to hide it until tomorrow; **Show the floating button again** in Settings brings it back.
- In this mode the service does **nothing in the background**: it reads the screen only at the moment you tap. That is more private, uses less battery, and is a narrower use of the Accessibility API than Automatic.
- The button is an Accessibility overlay, so it needs **no "Display over other apps" permission**. It never takes keyboard focus. TalkBack can activate it (it has a label and responds to double-tap).
- A tap and Automatic mode never send the same message twice: each remembers what the other sent.

**Quick Settings tile.** Pull the notification shade down, open the editing pencil, and drag **ActionBrain** in (or press **Add Quick Settings tile** in Settings: Android 13+ then asks "Add tile?"). Tap the tile to **pause all capture for an hour**; tap again to resume. It changes nothing but the pause.

**Defaults.** Notifications on, chat reading **Automatic** (so an install that already had live reading keeps working). Chat reading only does anything once you have switched it on in Android's Accessibility settings after the in-app consent.

**Limits of On tap:**
- Lines are stamped with the time they reach ActionBrain, not the time shown in WhatsApp. If you capture an old conversation, "tomorrow" in an old message is dated from now.
- The button's default place (right edge, a third of the way down) may sit over part of a chat. Drag it.
- It depends on WhatsApp's screen part names, like Automatic does (see the limits above). If it captures nothing, use **Show what the app sees**.

## Security design
- **One website.** The WebView only stays on your site (`https` and the exact host). Every other link opens in the phone's browser, never inside the app, so no other page can reach the bridge.
- **A narrow bridge.** The page can call only seven methods (a test checks the list). `saveIntake` accepts the token only if it is well formed **and** the address is exactly your site's `/api/intake`. The token goes in and never comes back out; the status the page reads contains no token.
- **Token at rest:** AES-256-GCM, with a key held in the Android Keystore (hardware-backed where the phone has it). Backups are off, so it is not copied to the cloud.
- **HTTPS only** (cleartext is off). The app sends the token to nowhere except your site.
- **Least reading:** only WhatsApp's notifications are looked at, and only when notification access is on and a token is present.
- The server still does the filtering (system notices, photos, allowed senders), has the 300/day cap, and drops repeats. See `docs/whatsapp-intake.md`.
- This is a **debug-signed** build. Fine for your own phone. Debug keys differ per computer, so an APK built on another machine cannot update this install: uninstall first (you will create a new token).

## Tests
- **Kotlin unit tests** (`android/app/src/test`, 51 tests, run with `./gradlew testFullDebugUnitTest`): token format, the "only your own address" rule, JSON escaping (including text that tries to break out of the JSON), length caps, duplicate suppression, the shared-chat hand-off, and the capture rules (`CapturePolicyTest`: every combination of notifications, mode, pause and hidden button), the live-reading logic including "capture everything visible" for the floating button (`ScreenReaderTest`: baseline, new messages only, scrolling around, switching chats, groups, who wrote it, never reading the typing box, the structure dump containing no message text). Breaking the token rule on purpose makes one fail.
- **TypeScript tests** (`tests/android-bridge.test.mts`, 12 tests): the website's bridge handling, and checks that the Kotlin and TypeScript sides agree (token format, bridge method list, address, permissions, locked-down manifest, only WhatsApp read).

## What was tested, and what was not
**Tested:** the app compiles and builds with Gradle 9.8 / AGP 9.4.1; the APK contains exactly the expected permissions and package; all unit tests pass; the website side lints, type-checks and is tested.

**NOT tested. Please try these yourself, and tell me what you see:**
- **Everything that needs a real WhatsApp message on a real phone:** whether the sender, text and group flag are read correctly from your WhatsApp's notifications (the code relies on Android's standard messaging fields; WhatsApp versions differ).
- The **Settings page inside the app**: the connect step, the status box, the buttons that open Android settings.
- **Notification access and restricted settings** on your Android 16 Samsung.
- **Microphone, file picker and Share** inside the app.
- **Battery behaviour** over hours (Samsung may stop background apps).
- **Back button / gesture** and **keyboard and edge-to-edge layout** on a real screen.
- **Screen readers** (TalkBack).
