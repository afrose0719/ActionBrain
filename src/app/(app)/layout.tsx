"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase";

// Wraps every logged-in page: checks the session, then shows the sidebar + top bar.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await createClient().auth.getUser();
      if (!data.user) return router.push("/login");
      setEmail(data.user.email ?? "");
    })();
  }, [router]);

  if (email === null) {
    return <div className="flex min-h-screen items-center justify-center text-ink-muted">Loading...</div>;
  }
  return <AppShell email={email}>{children}</AppShell>;
}
