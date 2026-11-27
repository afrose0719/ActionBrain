# Contributing to ActionBrain

Thank you for helping. ActionBrain is open source (Apache-2.0) and free for everyone.

## Before you open a pull request
1. `npm install`, then `npm run lint`, `npm run typecheck` and `npm test` must all pass (CI runs the same).
2. Add or update a unit test in `tests/` for every behaviour you change.
3. Android: `cd android && ./gradlew testFullDebugUnitTest assembleFullDebug assemblePlayDebug`.

## Rules
- **Never commit secrets** (`.env.local`, keys, tokens, `google-services.json`). Use `.env.example` for placeholders.
- **The AI never writes to the database.** AI output must go through the allow-list validator in `src/lib/ai/actions.ts` and be confirmed by the user.
- **Row Level Security stays on** for every table. New tables need `user_id = auth.uid()` policies.
- **Play vs full flavor.** Anything that uses an Accessibility service lives only in `android/app/src/full/`. Never add it to `src/main/`.
- **Sensitive data needs a prominent disclosure** (a native dialog with "Agree" and "Not now") before the Android permission or settings screen opens.
- **Do not overclaim.** Docs say what was tested and what was not.

## Security problems
See [SECURITY.md](SECURITY.md). Please report privately, not in a public issue.
