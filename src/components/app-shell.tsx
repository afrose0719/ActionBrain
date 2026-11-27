"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CheckSquare,
  Clock,
  Handshake,
  Inbox,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
  Video,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import { Wordmark } from "@/components/brand";

type NavItem = { label: string; href: string; icon: LucideIcon; soon?: boolean };

const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Commitments", href: "/commitments", icon: Handshake },
  { label: "Waiting For", href: "/waiting", icon: Clock },
  { label: "Meetings", href: "/meetings", icon: Video },
  { label: "Search", href: "/search", icon: Search },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      {/* first thing a keyboard user can Tab to: jumps past the navigation to the page content */}
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-50 -translate-y-20 rounded-md bg-surface px-4 py-2 font-medium text-brand-700 shadow-card transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-14 items-center border-b border-line px-5">
          <Wordmark size={28} />
        </div>

        <nav className="flex-1 space-y-1 p-3" aria-label="Main">
          {NAV.map(({ label, href, icon: Icon, soon }) => {
            const active = pathname === href;
            const base = "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium";
            if (soon) {
              return (
                <span key={href} className={`${base} cursor-not-allowed text-ink-subtle`}>
                  <Icon size={16} />
                  {label}
                  <span className="badge-low ml-auto">Soon</span>
                </span>
              );
            }
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`${base} group relative transition-colors ${
                  active ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-canvas hover:text-ink"
                }`}
              >
                {/* the active page gets a teal bar that grows in; others nudge their icon on hover */}
                <span
                  aria-hidden="true"
                  className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r bg-brand-600 transition-transform duration-200 ${
                    active ? "scale-y-100" : "scale-y-0"
                  }`}
                />
                <Icon size={16} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-surface px-6">
          <span className="md:hidden">
            <Wordmark size={24} />
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:inline">{email}</span>
            <button onClick={logOut} className="btn-secondary btn-sm">
              <LogOut size={14} />
              Log out
            </button>
          </div>
        </header>

        {/* On phones the sidebar is hidden, so every page is reachable from this scrollable bar. */}
        <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 md:hidden" aria-label="Pages">
          {NAV.filter((n) => !n.soon).map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${
                pathname === href ? "bg-brand-50 text-brand-700" : "text-ink-muted"
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </nav>

        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 p-4 outline-none sm:p-6 lg:p-8">
          {children}
        </main>
        <footer className="mx-auto flex w-full max-w-5xl flex-wrap gap-4 px-4 pb-6 text-xs text-ink-muted sm:px-6 lg:px-8">
          <span>ActionBrain is free and open source (Apache-2.0).</span>
          <Link href="/privacy" className="underline">Privacy</Link>
          <Link href="/terms" className="underline">Terms</Link>
          <a href="https://github.com/afrose0719/ActionBrain" className="underline">Source code</a>
        </footer>
      </div>
    </div>
  );
}
