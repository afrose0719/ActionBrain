"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

// Shown when a page crashes. Next.js passes `retry` (re-renders the page) in this version.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error); // swap for an error-reporting service (Sentry etc.) when you deploy
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-danger-50 text-danger-600">
        <TriangleAlert size={24} />
      </span>
      <div>
        <h1>Something went wrong</h1>
        <p className="page-subtitle">An unexpected error happened. Your data is safe.</p>
        {error.digest && <p className="mt-2 text-xs text-ink-subtle">Reference: {error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/dashboard" className="btn-secondary">
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}
