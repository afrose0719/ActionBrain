# ActionBrain Call Notes (Windows helper)

Takes notes on your **WhatsApp Desktop** and **Microsoft Teams** calls automatically. You don't click anything during the call.

## How it works
1. Windows keeps a list of which app is using the microphone (Settings → Privacy → Microphone; the microphone icon in the taskbar).
   Every 2 seconds the helper reads that list (`calls.cjs`). When WhatsApp or Teams starts using the microphone, a call has started.
2. It opens the ActionBrain **Meetings** page in a hidden window. The page records this computer's sound (the other people) and
   your microphone (you), the same as the "On this computer" option in Chrome, but without the share prompt.
3. When the app lets go of the microphone (after a 4-second grace period), the page turns the audio into text **on this computer**,
   saves only the text to your ActionBrain account, and suggests tasks. The audio is never uploaded or saved.
4. Anything shorter than 15 seconds (a voice note, a microphone test) is thrown away.

ActionBrain does **not** join the call and does **not** control WhatsApp or Teams. Nobody else sees a bot.

## Consent and control
- The first time it starts, the helper explains all this and asks you to agree (prominent disclosure). It then starts with Windows.
- Every call shows a notification: *"Taking notes on your Teams call. Tell the other people… Click here to skip this call."*
- Tray icon: status, Open ActionBrain, WhatsApp on/off, Teams on/off, Pause, Start with Windows, Quit.
- **Tell the other people** on the call ("I'm using ActionBrain to note action items, OK?"). Recording laws differ by country and state.

## Install (until a signed installer exists)
1. Unzip `ActionBrain-Call-Notes-<version>-win-x64.zip` somewhere permanent, for example `%LOCALAPPDATA%\ActionBrain Call Notes`.
2. Run `ActionBrain Call Notes.exe`. Windows SmartScreen may warn because the app is not code-signed yet: click **More info → Run anyway**.
3. Agree, then **sign in to ActionBrain** in the window that opens (once; the hidden recording windows use the same sign-in).
4. For WhatsApp calls, install **WhatsApp** from the Microsoft Store and take the call on the computer.

## Develop
```
cd desktop
npm install
node node_modules/electron/install.js   # only if npm skipped Electron's download
npm start                               # ACTIONBRAIN_URL=http://localhost:3000 to use a local site
npx electron-builder --win dir          # unpacked app in dist/win-unpacked
```
`ACTIONBRAIN_USER_DATA` (a separate profile) and `ACTIONBRAIN_DEBUG_PORT` (DevTools) are for testing only.
Detection logic is tested in `tests/desktop-calls.test.mts`.

## Security
- Only the ActionBrain site opens inside the helper; other links open in your normal browser.
- Context isolation and the sandbox are on; the page gets just `window.ActionBrainDesktop` (call ended, call skipped, report progress).
- Microphone, screen-sound and notification permissions are granted to the ActionBrain site only.

## Not yet
- A signed installer (the NSIS installer build was blocked on an unsigned test machine; ship signed builds).
- macOS (needs a different "who uses the microphone" check and ScreenCaptureKit audio).
- WhatsApp Web in a browser can't be told apart from other browser calls, so only the WhatsApp **app** is detected.
