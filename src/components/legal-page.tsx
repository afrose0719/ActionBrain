import Link from "next/link";
import type { ReactNode } from "react";

/** Where people send privacy and deletion requests. Set NEXT_PUBLIC_PRIVACY_CONTACT (an email address) when you deploy. */
export function privacyContact(): string | null {
  const value = process.env.NEXT_PUBLIC_PRIVACY_CONTACT?.trim();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export const LAST_UPDATED = "27 November 2026";

/** A public page (no login) for the privacy policy, terms and account deletion. Google Play and the browser stores link here. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="mb-2 text-sm text-ink-muted">
        <Link href="/" className="underline">ActionBrain</Link> · open source (Apache-2.0) · free for everyone
      </p>
      <h1 className="mb-1">{title}</h1>
      <p className="mb-8 text-sm text-ink-muted">Last updated: {LAST_UPDATED}</p>
      <div className="grid gap-6 leading-relaxed [&_h2]:mb-2 [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1">
        {children}
      </div>
      <nav className="mt-10 flex flex-wrap gap-4 border-t pt-4 text-sm" aria-label="Legal">
        <Link href="/privacy" className="underline">Privacy policy</Link>
        <Link href="/terms" className="underline">Terms</Link>
        <Link href="/delete-account" className="underline">Delete your account</Link>
        <a href="https://github.com/afrose0719/ActionBrain" className="underline">Source code</a>
      </nav>
    </main>
  );
}

/** How to reach a person. Without a configured address, people are pointed at the in-app deletion, which always works. */
export function ContactLine() {
  const contact = privacyContact();
  return contact ? (
    <p>
      Contact: <a className="underline" href={`mailto:${contact}`}>{contact}</a>
    </p>
  ) : (
    <p>Contact: use the in-app options described on this page. (The operator of this site has not set a contact address yet.)</p>
  );
}
