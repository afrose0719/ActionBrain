# Store release checklist (Google Play, Chrome Web Store, Edge, Firefox)

Built from the round-1 review by ChatGPT and Gemini (`docs/reviews/round-1.md`) and checked against the official pages linked below.
Policies change: re-read each source in the console before you submit.

## Google Play: the `play` build

| Requirement | Status in this repo | What you still do |
|---|---|---|
| Target API 36 (new apps and updates from 31 Aug 2026) | `targetSdk = 36` in `android/app/build.gradle.kts` | Check the uploaded bundle in Play Console. |
| No Accessibility service | Only in `src/full/`. `tests/store-compliance.test.mts` fails if it reaches the shared manifest. | Upload `bundlePlayRelease`, never `full`. |
| Prominent disclosure before notification access | Native dialog with **Agree and continue / Not now** (`WebBridge.openNotificationAccess`). | Record a short screen video of it for the Permissions declaration if asked. |
| Prominent disclosure before the microphone prompt | Native dialog before `RECORD_AUDIO` (`MainActivity.onPermissionRequest`). | — |
| Privacy policy URL | Public page `/privacy` | Enter `https://<your-domain>/privacy` in Play Console → App content. Set `NEXT_PUBLIC_PRIVACY_CONTACT`. |
| Account deletion: in-app path | Settings → Delete my account (web app inside the Android app) | — |
| Account deletion: web URL | Public page `/delete-account` | Enter it in Play Console → App content → Data deletion. |
| Data safety form | Draft below | Fill it in Play Console; it must match the shipped build. |
| Release signing, store listing, screenshots, content rating | Not done (the app is a debug APK today) | Create an upload key, `./gradlew bundlePlayRelease`, fill the listing. |

### Data safety draft (play build)
| Data type (Play category) | Collected | Shared | Optional? | Purpose | Notes |
|---|---|---|---|---|---|
| Personal info → Email address | Yes | No | Required | Account management | Sign-in |
| Messages → Other in-app messages (notification text from chat apps the user switches on) | Yes | No* | Optional | App functionality | *Sent to the user's own AI provider when they press Analyze, or automatically if they switch on "Analyse automatically" (Milestone 29). Check whether Play treats the automatic case as "shared" with a service provider; it is the user's own BYOK provider. |
| Audio → Voice or sound recordings | See the audio paths below | — | — | — | |
| App activity → Other user-generated content (tasks, commitments, transcripts, captured text) | Yes | No* | Required | App functionality | *as above |
| Location, contacts, financial, health, device IDs | No | — | — | — | |

Security practices: data encrypted in transit (yes); users can request deletion (yes, in-app and `/delete-account`).

### Audio, path by path (round-2 correction)
Google counts data as "collected" when it leaves the device, even briefly. So the answer depends on the path, not on one blanket rule.

| Path | Audio leaves the phone? | Declare |
|---|---|---|
| **Record** (meetings, calls) → Whisper in the app's WebView | No. Transcribed on the device. | The resulting **transcript** text, as user-generated content. Not "Voice or sound recordings". |
| Shared or chosen **call-recording file** → Whisper | No. Read and transcribed on the device. | The transcript text, as above. |
| **Mic button in the command box** (browser speech recognition) | **Possibly.** It uses the WebView/browser speech service, which may send audio to Google. In the Android WebView this API is usually unavailable, so the button may not appear at all. | If the Play build can use it, declare **Audio → Voice or sound recordings**, collected, App functionality, ephemeral. To be verified on a phone before submission. |

## Before submission: verify on a real phone
- The notification and microphone disclosures appear, "Not now" opens nothing and grants nothing.
- Whether the command-box mic button works in the Android WebView (decides the last row above).
- Record the screen of both disclosures for the Play Console permission declarations.

## Chrome Web Store, Edge Add-ons, Firefox
See `extension/STORE_LISTING.md`, `extension/PERMISSIONS.md` and `extension/PRIVACY_DATA_MAP.md`.

## Not now (decided in round 1)
- **Gmail add-on / Gmail API:** restricted Gmail scopes need Google's restricted-scope verification and a yearly security assessment (CASA) when data is stored on a server. Deferred; the `.eml` import and the extension cover Gmail for now.
- **Outlook add-in:** needs Partner Center submission and validation. Deferred; Microsoft Graph (already used for Teams) is the route for Outlook mail later.

## Official sources
- Target API level: https://support.google.com/googleplay/android-developer/answer/11926878
- AccessibilityService API policy: https://support.google.com/googleplay/android-developer/answer/10964491
- Prominent disclosure and consent: https://support.google.com/googleplay/android-developer/answer/11150561
- Account deletion requirement: https://support.google.com/googleplay/android-developer/answer/13327111
- Data safety section: https://support.google.com/googleplay/android-developer/answer/10787469
- Chrome Web Store program policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- Chrome Web Store Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
- Firefox Manifest V3: https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/
- Google restricted scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Google API Services User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- Publish an Office add-in to Microsoft Marketplace: https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish-office-add-ins-to-appsource
