# The ActionBrain Android app (Milestone 23)

A small native Android app (Kotlin, no libraries) that shows your ActionBrain website in a window and adds the phone abilities a website cannot have by itself. It replaces any third-party automation app for WhatsApp messages.

## What it does
- **Opens your ActionBrain website** (and only that one site). You log in once; the login stays.
- **Forwards WhatsApp messages to your Inbox.** It reads WhatsApp's notifications (only WhatsApp and WhatsApp Business) after **you** switch on Notification access for ActionBrain. Group chats are recognised reliably, using the group flag Android attaches to the notification.
- **Gets its token from the website.** In **Settings → Phone messages**, press **Create my private link** inside the app. The page hands the token to the app, which keeps it encrypted in Android's Keystore. Nothing to copy or paste.
- **Share to ActionBrain.** Share text from any app and choose ActionBrain: it opens the Inbox with the text filled in.
- **Microphone and file pickers work inside it** (Record a call, Use a call recording, Import chat). The microphone is asked for only when you press Record.
- Shows its own status in Settings: connected, notification access on/off, messages sent and failed.

## What it cannot do (Android's rules, not a gap in the app)
- It **cannot hear phone calls**. Android does not give ordinary apps both sides of a cellular call. (Call detection and your phone's own call recordings are the planned next step, Milestone 24.)
- It sees only the notification **preview**: very long messages arrive cut off, and a message you read before the notification appeared will not be seen.
- There is **no offline queue**: if the phone has no internet for about 12 seconds after a message, that message is counted as failed and is not retried later.
- Android shows the **latest** message of a notification. If several arrive within a fraction of a second, an earlier one can be missed.

## Permissions
Only **Internet** and **Microphone** (asked at the moment you press Record). It does **not** ask for call log, phone state, SMS, contacts, location or storage. A test (`tests/android-bridge.test.mts`) fails if that ever changes. Notification access is not an install-time permission: Android makes you switch it on yourself in Settings, and you can switch it off there at any time.

## Install on your phone
The app is a file (`app-debug.apk`), not a Play Store app. It is for your own use.
1. Build it (below), or get the APK from whoever built it.
2. **With a USB cable** (what I used): on the phone, Settings → About phone → tap **Build number** 7 times, then Developer options → **USB debugging** on. Connect, accept the prompt, then on the PC:
   `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`
   Many Samsung phones also show an **"Install via USB"** prompt on the phone. Accept it (and turn on "Install via USB" in Developer options if it is there).
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
./gradlew testDebugUnitTest assembleDebug                      # APK: app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleDebug -PactionbrainUrl=https://your-site.vercel.app   # point it at your own deployment
```
The app opens `actionbrainUrl` (default: the deployed site) and refuses to build with anything that is not `https://`.

**Windows note:** Gradle downloads its own copy of `aapt2.exe`, which Windows "Application Control" or Smart App Control may block. Use the Google-signed one from the SDK instead, in your **user** Gradle file (`~/.gradle/gradle.properties`):
`android.aapt2FromMavenOverride=C:/path/to/Android/Sdk/build-tools/36.0.0/aapt2.exe`

## Security design
- **One website.** The WebView only stays on your site (`https` and the exact host). Every other link opens in the phone's browser, never inside the app, so no other page can reach the bridge.
- **A narrow bridge.** The page can call only seven methods (a test checks the list). `saveIntake` accepts the token only if it is well formed **and** the address is exactly your site's `/api/intake`. The token goes in and never comes back out; the status the page reads contains no token.
- **Token at rest:** AES-256-GCM, with a key held in the Android Keystore (hardware-backed where the phone has it). Backups are off, so it is not copied to the cloud.
- **HTTPS only** (cleartext is off). The app sends the token to nowhere except your site.
- **Least reading:** only WhatsApp's notifications are looked at, and only when notification access is on and a token is present.
- The server still does the filtering (system notices, photos, allowed senders), has the 300/day cap, and drops repeats. See `docs/whatsapp-intake.md`.
- This is a **debug-signed** build. Fine for your own phone. Debug keys differ per computer, so an APK built on another machine cannot update this install: uninstall first (you will create a new token).

## Tests
- **Kotlin unit tests** (`android/app/src/test`, 9 tests, run with `./gradlew testDebugUnitTest`): token format, the "only your own address" rule, JSON escaping (including text that tries to break out of the JSON), length caps, duplicate suppression. Breaking the token rule on purpose makes one fail.
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
