# Review round 1 (27 November 2026): ChatGPT and Gemini

Build reviewed: `main` at `df5b5cf` (330/330 tests, lint and typecheck clean). Both reviewers got the same summary and the repo link.
Note: ChatGPT said it could not fetch the GitHub source, so its review rests on the summary plus policy pages; Gemini did not say whether it read the code.

## Where they agreed (done in this round)
| # | Item | Done |
|---|---|---|
| 1 | Apache-2.0 licence, NOTICE, SECURITY.md, CONTRIBUTING.md | Yes |
| 2 | Public privacy policy, terms, and an account-deletion page without login | `/privacy`, `/terms`, `/delete-account` |
| 3 | Prominent disclosure (Agree / Not now) before notification access and the microphone prompt on Android | Native dialogs |
| 4 | Prove the Accessibility service never reaches the Play build | `tests/store-compliance.test.mts` |
| 5 | Extension store documents: permission justifications, data map, listing | `extension/PERMISSIONS.md`, `PRIVACY_DATA_MAP.md`, `STORE_LISTING.md` |
| 6 | Defer the Gmail add-on and Outlook add-in; use APIs later | Recorded in `docs/store-release.md` |

## Next rounds (agreed, not done yet)
- Deduplication with a source hash / client event id, and an offline queue on Android (WorkManager + Room) so captures survive no-network and restarts.
- AI output with confidence, language, owner direction and due date; opt-in auto-create for high confidence only (off by default).
- Revoke a lost phone's intake token from the web; payload size caps on intake and analyze.
- Release signing and a Play internal-testing upload; a merged-manifest check in CI with a real Gradle build.
- Multilingual test set (Tamil, Hindi, Malayalam, Telugu, Kannada, code-switched).

## Where I did not follow a suggestion, and why
- Gemini asked for security headers: they already exist (`next.config.ts`: CSP, X-Frame-Options, nosniff, referrer policy, HSTS).
- Gemini asked for intake rate limiting: a per-user limit already exists in the database ingest function; a per-token revoke is still open (above).
- Gemini quoted a CASA cost range from a non-official site; that number is not repeated here.

## Sources
Listed in `docs/store-release.md` (official Google, Chrome, Mozilla and Microsoft pages).
