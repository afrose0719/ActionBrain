# Extension permissions (store justifications)

Paste these into the Chrome Web Store dashboard (Privacy practices → Permission justification), Edge Partner Center and the Firefox AMO listing.
`tests/store-compliance.test.mts` fails if `manifest.json` asks for a permission that is not listed here.

**Single purpose:** send text you choose to your ActionBrain Inbox, and remind you of your own ActionBrain tasks and commitments that are due.

| Permission | Why it is needed | When it is used | How to revoke |
|---|---|---|---|
| `contextMenus` | Adds the "Send to ActionBrain" item to the right-click menu for selected text. | Only when you right-click a selection and choose it. | Remove or disable the extension. |
| `storage` | Keeps you signed in (your ActionBrain session), your "reminders on/off" choice, and which reminders were already shown so they are not repeated. Stored locally in the browser only. | Every time the popup opens or a reminder check runs. | Log out in the popup (removes the session), or remove the extension. |
| `notifications` | Shows desktop reminders for your tasks and commitments that are due or overdue, and confirms a capture. | Every 15 minutes, only if reminders are on and something is due. | Turn reminders off in the popup. |
| `alarms` | Runs the reminder check every 15 minutes without a page staying open in the background (Manifest V3). | Every 15 minutes. | Turn reminders off in the popup. |
| `https://jqbdeydalcaltfmdphon.supabase.co/*` (host permission) | The only server the extension talks to: ActionBrain's own database and sign-in (Supabase), over HTTPS. Used to sign in, to save the text you send, and to read your own due tasks for reminders. | Sign-in, "Send to ActionBrain", reminder checks. | Remove the extension. |

Not requested: `<all_urls>`, `tabs`, `history`, `cookies`, `scripting`, `webRequest`, `activeTab`. The extension never reads a page by itself; the browser gives it only the text you selected.

**Remote code:** none. All JavaScript is in the package. The extension only sends and receives JSON data.

If you deploy your own copy with a different Supabase project, change the host permission in `manifest.json` and in this table.
