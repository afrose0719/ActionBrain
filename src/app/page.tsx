import Link from "next/link";
import { Brain } from "lucide-react";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
        <Brain size={24} />
      </span>
      <div>
        <h1 className="text-2xl">ActionBrain</h1>
        <p className="page-subtitle">Never lose a commitment again.</p>
      </div>
      <Link href="/login" className="btn-primary">
        Log in / Sign up
      </Link>
    </main>
  );
}
