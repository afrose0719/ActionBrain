"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Brain,
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
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-line px-5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white">
            <Brain size={16} />
          </span>
          <span className="text-base font-semibold">ActionBrain</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
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
                className={`${base} transition-colors ${
                  active ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-canvas hover:text-ink"
                }`}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-surface px-6">
          <span className="text-sm font-semibold md:hidden">ActionBrain</span>
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
              className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${
                pathname === href ? "bg-brand-50 text-brand-700" : "text-ink-muted"
              }`}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </nav>

        <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
