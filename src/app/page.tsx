import Link from "next/link";
import { BellRing, Handshake, MessageSquareText, Sparkles } from "lucide-react";
import { Logo } from "@/components/brand";

const STEPS = [
  { icon: MessageSquareText, title: "It hears it", text: "WhatsApp, Teams, email, meetings: the promises in them are caught for you." },
  { icon: Sparkles, title: "It understands it", text: "Who promised what, to whom, and by when. In English, Tamil, Hindi and more." },
  { icon: Handshake, title: "It keeps track", text: "Your tasks, and what others owe you, in one calm list." },
  { icon: BellRing, title: "It reminds you", text: "At the right moment, before anything slips." },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <div className="animate-rise flex flex-col items-center gap-5">
        <Logo size={64} alive />
        <div>
          <h1 className="text-2xl sm:text-3xl">
            Never lose a <span className="text-brand-600">commitment</span> again.
          </h1>
          <p className="page-subtitle mx-auto max-w-md text-base">
            ActionBrain quietly remembers what you promised and what you are owed, and turns it into tasks you approve.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/login" className="btn-primary h-11 px-6 text-base">
            Get started free
          </Link>
          <Link href="/brand" className="btn-secondary h-11 px-6 text-base">
            See the design
          </Link>
        </div>
        <p className="text-xs text-ink-muted">Free and open source. Your own AI key. Your data stays yours.</p>
      </div>

      <ol className="grid w-full gap-3 text-left sm:grid-cols-2">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="card-interactive animate-rise card-body flex gap-3" style={{ "--i": i + 2 } as React.CSSProperties}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <Icon size={18} />
            </span>
            <span>
              <span className="block font-semibold">{title}</span>
              <span className="text-ink-muted">{text}</span>
            </span>
          </li>
        ))}
      </ol>

      <nav className="flex gap-4 text-xs text-ink-muted" aria-label="Legal">
        <Link href="/privacy" className="underline">Privacy</Link>
        <Link href="/terms" className="underline">Terms</Link>
        <a href="https://github.com/afrose0719/ActionBrain" className="underline">Source code</a>
      </nav>
    </main>
  );
}
