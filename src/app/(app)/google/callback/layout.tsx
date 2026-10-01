import type { Metadata } from "next";

// The page itself is a client component, so its title lives here. The root layout adds " · ActionBrain".
export const metadata: Metadata = { title: "Connecting Google Calendar" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
