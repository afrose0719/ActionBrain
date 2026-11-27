import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy policy" };

// Public, no login (Google Play, Chrome Web Store, Edge Add-ons and Firefox require a reachable privacy policy).
// Keep this page in step with SECURITY.md, docs/store-release.md (Data safety draft) and extension/PRIVACY_DATA_MAP.md.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <section>
        <p>
          ActionBrain is an open-source, free app that turns what you say, receive and promise into tasks and commitments you approve.
          It has no ads, sells no data, and has no paid tier. This policy covers the web app, the ActionBrain Android app and the
          ActionBrain browser extension.
        </p>
      </section>

      <section>
        <h2>What we collect, and why</h2>
        <ul>
          <li><b>Account:</b> your email address and a password hash (Supabase Auth), to sign you in.</li>
          <li><b>Content you choose to capture:</b> text you paste, chat exports and emails you import, text you send from the browser extension, meeting transcripts, and your tasks, commitments and notes. Used only to show you your Inbox, tasks and reminders.</li>
          <li><b>Phone notifications (Android app, only if you turn it on):</b> the sender name and message text of notifications from the chat apps you switch on (for example WhatsApp or Microsoft Teams). They are sent to your own Inbox.</li>
          <li><b>Live chat reading (only in the separately installed &quot;full&quot; Android build, not the Google Play build):</b> the chat name and message text while a chat you switched on is open on screen.</li>
          <li><b>Microphone, recordings:</b> only when you press Record. Speech is transcribed <b>on your device</b>; the audio is not uploaded. Only the resulting text is saved.</li>
          <li><b>Microphone, voice commands:</b> the mic button in the command box uses your browser&apos;s built-in speech recognition. Some browsers (for example Google Chrome) send that audio to their own speech service to turn it into text. ActionBrain itself receives only the text.</li>
          <li><b>Connected accounts (optional):</b> Google Calendar (read-only, to list your meetings) and Microsoft Teams chats (when you connect them). We store only an encrypted refresh token, not your calendar.</li>
          <li><b>Your AI key (optional):</b> the Anthropic, OpenAI or Gemini key you add, stored encrypted.</li>
        </ul>
        <p className="mt-2">We do not collect location, contacts, call logs, advertising IDs or analytics trackers.</p>
      </section>

      <section>
        <h2>Who it is shared with</h2>
        <ul>
          <li><b>Your AI provider, only when you ask:</b> when you press Analyze (or use the command box or search), the relevant text is sent to the AI provider you chose, using your own key. Their privacy terms apply to that request.</li>
          <li><b>Service providers that host the app:</b> Supabase (database and sign-in) and Vercel (web hosting).</li>
          <li><b>Nobody else.</b> We never sell your data, never use it for advertising, and never let people read it, except when you ask us for help, for security, or when the law requires it.</li>
        </ul>
      </section>

      <section>
        <h2>Google APIs (Limited Use)</h2>
        <p>
          ActionBrain requests one Google scope: read-only Google Calendar, only if you connect it. ActionBrain&apos;s use and transfer of
          information received from Google APIs adheres to the{" "}
          <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
          including the Limited Use requirements. Calendar events are read only to let you pick a meeting in ActionBrain; they are not stored (except the title and time of a
          meeting you choose to save), sold, used for advertising, or used to train AI models.
        </p>
      </section>

      <section>
        <h2>Browser extension</h2>
        <p>
          The extension&apos;s single purpose is to send the text you select to your ActionBrain Inbox and to remind you of your own tasks.
          It reads no page by itself. The data it handles is used only for that purpose, never sold, never used for advertising or
          creditworthiness, and never transferred except to provide that purpose, as the Chrome Web Store User Data Policy requires.
        </p>
      </section>

      <section>
        <h2>Security</h2>
        <ul>
          <li>All traffic uses HTTPS (TLS). Data is encrypted at rest by the database host.</li>
          <li>AI keys and Google/Microsoft tokens are additionally encrypted with AES-256-GCM.</li>
          <li>Every database row is locked to its owner (Row Level Security).</li>
          <li><b>Not end-to-end encrypted:</b> the server can read your content, and text sent to your AI provider is readable by that provider.</li>
        </ul>
      </section>

      <section>
        <h2>How long we keep it, and your rights</h2>
        <ul>
          <li>We keep your data until you delete it or delete your account.</li>
          <li><b>Export:</b> Settings → Your data → Export (JSON, or tasks as CSV).</li>
          <li><b>Delete:</b> Settings → Delete my account removes your account and all your data immediately. See <Link className="underline" href="/delete-account">Delete your account</Link>.</li>
          <li><b>Stop capture:</b> switch sources off in Settings, pause from the Android Quick Settings tile, or revoke the Android permission at any time. Capture stops at once; messages already in your Inbox stay until you delete them.</li>
          <li><b>Disconnect a phone:</b> Settings → Phone messages (WhatsApp) → Turn off (or New token) stops the old phone token immediately. The phone does not keep a backlog of unsent messages: it retries a message a few times in memory, then drops it.</li>
          <li><b>Retry records:</b> to avoid saving a message twice, the server keeps the phone&apos;s message id (no message text) for 30 days.</li>
          <li>You can ask to access, correct or erase your data, and to withdraw consent, including under India&apos;s Digital Personal Data Protection Act, 2023.</li>
        </ul>
      </section>

      <section>
        <h2>Children</h2>
        <p>ActionBrain is not intended for children under 18.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>We update this page when the app changes and change the date above. The source code is public, so you can check what the app does.</p>
        <ContactLine />
      </section>
    </LegalPage>
  );
}
