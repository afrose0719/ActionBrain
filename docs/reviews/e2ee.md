# End-to-end encryption (27 November 2026): ChatGPT and Gemini

**Owner's requirement:** "Even though I own ActionBrain, I must not be able to see customers' data. I may only see customer details
(who signed up, who installed the app) and help when they ask for support."

**Today (honest):** Row Level Security separates customers from each other, and there is TLS plus disk encryption, but the **owner can
read every row** in the Supabase dashboard. AI keys and Google/Microsoft tokens are encrypted with a server key that the owner (who
controls Vercel) could also use. **ActionBrain is not end-to-end encrypted, and must not claim to be until the plan below is done.**

## What both reviewers agree on
1. **Architecture:** each user's content is encrypted **on their own devices** with a vault key the server never sees
   (AES-256-GCM, envelope encryption: a key per record wrapped by the vault key, as in the Bitwarden and 1Password designs).
   Writes from the phone and from sync encrypt to the user's **public key** (libsodium sealed box or HPKE, RFC 9180), so the server
   can store new items but never read them.
2. **The server-side zero-touch worker (Milestone 29) cannot stay** for encrypted users: it decrypts the AI key and reads messages.
   AI analysis moves to the **user's own phone or browser**, calling their AI provider directly with their key. If the phone is
   offline, analysis waits. Gemini: "truly locked-device server-side AI extraction is mutually exclusive with zero-knowledge E2EE."
3. **Search, the waiting-for briefing and the command box** run on the device (the data per user is small enough).
   **Teams and Google Calendar** sync from the device (or, as a disclosed compromise, the server seals the text to the user's public key
   the moment it fetches it).
4. **Metadata that may stay readable** (with disclosure in `/privacy`): status, created time, record type, and optionally due date,
   space (personal/work) and priority so reminders and filters work. Titles, bodies, quotes, senders, transcripts: encrypted.
5. **Unlock and recovery:** Android Keystore on the phone; WebAuthn **PRF** passkey as a convenient unlock where the browser supports
   it; **always** a passphrase (Argon2id) and a one-time **recovery key** the user must save. New devices are added by QR code from a
   trusted device. **If a user loses every device, the passphrase and the recovery key, nobody can recover the data, not even the
   owner.** That is the honest cost.
6. **Owner admin page:** an `app_admins` table plus one locked-down security-definer function that returns only email, sign-up date,
   last active, app versions, device count and counts. Never content, never keys. Negative tests must prove it.
7. **Support:** no hidden "support mode" with access to a user's key (that would be a backdoor). Instead the **customer** creates a
   support snapshot on their device (decrypted, scrubbed of keys, optionally including chosen messages), encrypted to the support key,
   expiring after 24 hours; or metadata-only diagnostics.
8. **Order:** B (consent + audit) → C (owner admin page, metadata only) → A (E2EE in waves). B and C document and limit access but do
   **not** stop the owner reading today; only A does.

## E2EE waves (merged from both)
| Wave | What | Effect |
|---|---|---|
| A0 | Threat model: what the owner, host, AI provider and other devices can see | Honest statements |
| A1 | Move AI keys and OAuth tokens off the server: encrypted with the user's vault key, used only on devices | Owner can no longer use customers' keys; content queries keep working |
| A2 | Phone and extension seal captured messages to the user's public key; devices decrypt and run AI locally | Inbox becomes unreadable to the owner |
| A3 | Encrypt tasks, commitments, meetings and suggestions; local search index | Owner sees only metadata |
| A4 | Recovery key, QR device adding, lost-device revocation, key rotation | Must exist before broad rollout |
| A5 | Migrate existing data on each user's device, then delete the plaintext rows (and note backup expiry) | Old data protected too |

## Cautions recorded
- E2EE does not protect against a **malicious future app update** (the owner ships the code). Mitigation: open source, signed releases,
  reproducible builds (ChatGPT).
- Android's "no libraries" rule: X25519 in the platform crypto needs newer Android versions than the app's minimum (26); a small,
  well-reviewed crypto library may be needed. To decide in A2.
- Push notifications must carry no content ("ActionBrain has an update"); the device decrypts and shows the text.
- Sealed boxes alone are not a multi-device protocol (no sender authentication, rotation or revocation); use a reviewed device-key
  design (ChatGPT).

## Sources (given by the reviewers)
OWASP Cryptographic Storage and Password Storage cheat sheets; NIST SP 800-38D (GCM) and key-management guidance; W3C WebAuthn
Level 3 (PRF extension); W3C Web Crypto; libsodium sealed boxes; RFC 9180 (HPKE); RFC 9106 (Argon2); Signal X3DH; 1Password and
Bitwarden security whitepapers; Android Keystore documentation; Supabase security-definer guidance.
