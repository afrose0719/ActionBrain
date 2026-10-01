# Google Calendar setup (read-only, free)

You do this once. It takes about 10 minutes. ActionBrain asks for **view-only** access to your calendar events.

## 1. Create a Google Cloud project
1. Go to https://console.cloud.google.com and sign in with the Google account whose calendar you want to use.
2. Click the project picker at the top, then **New project**. Name it `ActionBrain` and click **Create**.
3. Make sure `ActionBrain` is the selected project.

## 2. Turn on the Calendar API
1. Open **APIs & Services → Library**.
2. Search for **Google Calendar API**, open it, and click **Enable**.

## 3. Set up the consent screen
1. Open **APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform**).
2. Click **Get started**. App name: `ActionBrain`. User support email: your email.
3. Audience: choose **External**. Add your email as the contact. Finish.
4. Open **Data Access** (or **Scopes**), click **Add or remove scopes**, and add only:
   - `.../auth/calendar.events.readonly`
   - `openid` and `.../auth/userinfo.email`
5. Open **Audience** and add **your own Google email** under **Test users**.

> The app stays in **Testing** mode. That is fine for you, but Google expires the login every **7 days**, so you will click "Connect" again about once a week. Publishing the app removes this. The calendar read scope is non-sensitive, so publishing needs no verification review. Do that later, before sharing the app with others.

## 4. Create the OAuth client
1. Open **Clients** (or **Credentials → Create credentials → OAuth client ID**).
2. Application type: **Web application**. Name: `ActionBrain web`.
3. Under **Authorized redirect URIs**, add exactly:
   ```
   http://localhost:3000/google/callback
   ```
   When you deploy, add your real address too, for example `https://your-app.vercel.app/google/callback`.
4. Click **Create**. Copy the **Client ID** and **Client secret**.

## 5. Add them to `.env.local`
Open `.env.local` in the project root and add (no quotes, no spaces):
```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```
The client secret is a **secret**: never paste it in chat or commit it. `.env.local` is already git-ignored.

## 6. Create the database table
In Supabase, **SQL Editor → New query**, paste the contents of `supabase/milestone13-google.sql`, and click **Run**.

## 7. Restart and connect
1. Stop the dev server (`Ctrl+C`) and run `npm run dev`.
2. Open **Settings → Google Calendar → Connect Google Calendar**.
3. Google shows a warning "Google hasn't verified this app". That is normal in Testing mode. Click **Advanced → Go to ActionBrain (unsafe)**, keep the calendar box ticked, and **Continue**.
4. You return to Settings and see "Connected as you@gmail.com".

## Using it
**Meetings → New meeting → Fill from Google Calendar**. Pick an event and the title, time and attendees are filled in. Then paste the transcript.

## Troubleshooting
- **`redirect_uri_mismatch`:** the URI in Google Cloud must match exactly, including `http` vs `https` and no trailing slash.
- **"Access blocked: app has not completed verification" / `access_denied`:** your email is not in **Test users**.
- **"Google did not return a refresh token":** open https://myaccount.google.com/permissions, remove ActionBrain, and connect again.
- **"Calendar access was not granted":** you unticked the calendar permission. Connect again and leave it ticked.
- **"Google access has expired":** normal after 7 days in Testing mode. Click Connect again.
- **"Not set up on this server yet":** the two env vars are missing, or the server was not restarted.

## What ActionBrain stores
Only an **encrypted refresh token** and your Google email. It never stores your events. They are fetched when you click the button and shown, not saved. **Disconnect** deletes the token and asks Google to revoke it.
