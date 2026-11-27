import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, privacyContact } from "@/components/legal-page";

export const metadata: Metadata = { title: "Delete your account" };

// Google Play requires a public web page (no app install needed) that explains how to delete an account and its data.
// Its URL goes in Play Console → App content → Data deletion.
export default function DeleteAccountPage() {
  const contact = privacyContact();
  return (
    <LegalPage title="Delete your ActionBrain account">
      <section>
        <h2>Delete it yourself (immediate)</h2>
        <p>This works on any device with a browser. You do not need the Android app.</p>
        <ul>
          <li>Open <Link className="underline" href="/settings">ActionBrain Settings</Link> (log in if asked).</li>
          <li>Scroll to <b>Delete my account</b>.</li>
          <li>Type <b>DELETE</b> and press <b>Delete my account and data</b>.</li>
        </ul>
        <p className="mt-2">In the Android app it is the same: Settings → Delete my account.</p>
      </section>

      <section>
        <h2>What is deleted</h2>
        <ul>
          <li>Your account (email and password).</li>
          <li>All tasks, commitments, Inbox items, meetings and transcripts.</li>
          <li>Your encrypted AI key, your Google and Microsoft connections, and your phone intake tokens (a phone that still has one can no longer send anything).</li>
        </ul>
        <p className="mt-2">
          Deletion is immediate and permanent. Nothing is kept afterwards, except encrypted database backups held by our host, which expire on
          their normal schedule. Want a copy first? Use Settings → Your data → Export before you delete.
        </p>
        <p className="mt-2">To remove data captured on the phone itself, uninstall the ActionBrain app.</p>
      </section>

      <section>
        <h2>Cannot log in?</h2>
        {contact ? (
          <p>
            Reset your password from the login page, or email <a className="underline" href={`mailto:${contact}?subject=Delete%20my%20ActionBrain%20account`}>{contact}</a>{" "}
            from the address you signed up with. We confirm it is your account and delete it within 30 days.
          </p>
        ) : (
          <p>Use <b>Forgot password?</b> on the login page to get back in, then delete the account as above.</p>
        )}
      </section>
    </LegalPage>
  );
}
