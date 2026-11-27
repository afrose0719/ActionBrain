import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <section>
        <h2>Free and open source</h2>
        <p>
          ActionBrain is free. Its source code is published under the{" "}
          <a className="underline" href="https://www.apache.org/licenses/LICENSE-2.0">Apache License 2.0</a>. You may use, change and share it under that licence.
        </p>
      </section>
      <section>
        <h2>Your AI key and its cost</h2>
        <p>
          AI features use the AI key you add. Any charges from your AI provider are between you and that provider. You can remove your key at any time.
        </p>
      </section>
      <section>
        <h2>Your content and other people</h2>
        <p>
          You own what you capture. Messages often contain other people&apos;s words; only capture what you are allowed to, follow your
          organisation&apos;s rules for work chats, and respect the laws on recording where you live.
        </p>
      </section>
      <section>
        <h2>AI can be wrong</h2>
        <p>Suggestions may be incomplete or wrong. ActionBrain never creates anything until you confirm it; check before you rely on a date or a promise.</p>
      </section>
      <section>
        <h2>No warranty</h2>
        <p>
          ActionBrain is provided &quot;AS IS&quot;, without warranties or conditions of any kind, as set out in the Apache License 2.0.
          To the extent the law allows, the contributors are not liable for any loss arising from its use.
        </p>
      </section>
      <section>
        <h2>Privacy</h2>
        <p>See the <Link className="underline" href="/privacy">privacy policy</Link>.</p>
        <ContactLine />
      </section>
    </LegalPage>
  );
}
