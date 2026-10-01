# ActionBrain Chrome extension

Two jobs:
1. **Capture.** Select text on any web page → right-click → **Send to ActionBrain**. It lands in your Inbox, ready for "Analyze with AI".
2. **Reminders.** Desktop notifications for tasks and commitments that are due soon or overdue, even when the ActionBrain tab is closed.

## Install (developer mode)
1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `extension` folder.
4. Click the puzzle-piece icon → pin **ActionBrain**.
5. Click the ActionBrain icon and log in with your ActionBrain account.

## Use
- Select text on any page, right-click, choose **Send to ActionBrain**.
- Or click the toolbar icon and paste text into **Quick capture**.
- In the web app, open **Inbox** and click **Analyze with AI** on the new item.

## Reminders
Every 15 minutes the extension checks your tasks and commitments and shows a desktop notification for:
- a **task or commitment of yours** that is due within the next hour (shown once);
- a **task or commitment of yours that is overdue** (shown once per day until you finish it, and not after it is a week late);
- something **someone owes you that is overdue**: "Time to chase Anish".

If more than three are new at once, you get a single summary notification instead. Clicking a notification opens the right ActionBrain page. Turn reminders off in the extension popup.

Notes:
- You must be logged in to the extension (click its icon).
- Chrome must be running. If you see nothing, check Windows **Settings → System → Notifications** (and Focus Assist / Do Not Disturb).
- It reads only your own tasks and commitments, using the same login as the web app.

## After you change a file
Go to `chrome://extensions` and click the reload (circular arrow) button on the ActionBrain card.

## Configuration
`config.js` holds the Supabase URL, the publishable key (public by design) and `APP_URL`.
When you deploy the web app, change `APP_URL` to your real address.
If you ever change the Supabase project, also update `host_permissions` in `manifest.json`.

## Security notes
- The extension signs in with your own account; Row Level Security limits it to your own data.
- Your login token is kept in `chrome.storage.local`, which only this extension can read.
- Never put a `secret` or `service_role` key in this folder.
