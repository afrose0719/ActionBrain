import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <SearchX size={24} />
      </span>
      <div>
        <h1>Page not found</h1>
        <p className="page-subtitle">That page does not exist or was moved.</p>
      </div>
      <Link href="/dashboard" className="btn-primary">
        Go to Dashboard
      </Link>
    </main>
  );
}
