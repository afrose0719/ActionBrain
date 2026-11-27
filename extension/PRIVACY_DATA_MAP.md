# Extension data map (for store privacy forms)

Use this for Chrome Web Store "Privacy practices", Edge "Privacy" fields and Firefox data-collection disclosures. Keep it in step with `/privacy`.

| Data | Collected? | Where it goes | Why | Stored |
|---|---|---|---|---|
| Email address and password | At sign-in only | Supabase Auth (HTTPS) | Sign in | The password is never stored by the extension; the session token is stored in `chrome.storage.local` |
| Text you select and send | Only when you choose "Send to ActionBrain" or Quick capture | Your ActionBrain Inbox (Supabase, HTTPS) | The single purpose | In your account until you delete it |
| Your tasks and commitments (title, due date, person) | Read for reminders | Read from your account; nothing new is sent | Reminders | Only the ids of reminders already shown, locally |
| Page URL, browsing history, page content you did not select | **No** | — | — | — |
| Location, contacts, financial or health data | **No** | — | — | — |

Chrome Web Store certifications (all true):
- Data is not sold to third parties.
- Data is not used or transferred for purposes unrelated to the single purpose.
- Data is not used or transferred to determine creditworthiness or for lending.

Privacy policy URL: `https://<your-domain>/privacy`.
