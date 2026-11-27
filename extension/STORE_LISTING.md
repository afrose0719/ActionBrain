# Store listing draft (Chrome Web Store, Edge Add-ons, Firefox AMO)

**Name:** ActionBrain

**Short description (≤132 chars):** Send selected text to your ActionBrain Inbox and get reminders for your tasks and commitments. Free and open source.

**Category:** Productivity

**Description:**
ActionBrain turns what you read into tasks you approve.
- Select text on any page, right-click, and choose **Send to ActionBrain**. It lands in your ActionBrain Inbox, where AI suggests tasks and commitments. Nothing is created until you confirm.
- Get desktop reminders for your tasks and commitments that are due or overdue, and a nudge when someone owes you something.

The extension never reads pages by itself, has no ads, and sells no data. It is open source (Apache-2.0) and free: https://github.com/afrose0719/ActionBrain
You need a free ActionBrain account.

**Privacy policy:** `https://<your-domain>/privacy` · **Support:** the web app's address (stores reject a GitHub link as the only support URL for some listings).

## Packaging
- Chrome and Edge: zip the contents of `extension/` (manifest at the zip root). Edge accepts the same Manifest V3 package.
- Firefox: add `"browser_specific_settings": { "gecko": { "id": "<your id>" } }` to the manifest before submitting. The code is plain, unminified JavaScript, so no separate source upload is needed. Firefox support is untested.
- Before each upload set `APP_URL` in `config.js` to the deployed site.

## Reviewer test plan
1. Install, click the icon, sign in with a test account.
2. Select text on any page → right-click → **Send to ActionBrain** → it appears in the web app's Inbox.
3. Create a task due in 30 minutes in the web app; within 15 minutes a desktop notification appears; clicking it opens the task.
4. Turn reminders off in the popup → no more notifications. Log out → the session is removed.

## Sources
- Chrome Web Store program policies: https://developer.chrome.com/docs/webstore/program-policies/policies
- Chrome Web Store Limited Use: https://developer.chrome.com/docs/webstore/program-policies/limited-use
- Firefox Manifest V3 guide: https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/
