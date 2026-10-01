"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain } from "lucide-react";
import { createClient } from "@/lib/supabase";

// The link in the reset email brings the user here. Supabase signs them in "for recovery" automatically,
// and the only thing that session may be used for here is choosing a new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [waited, setWaited] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true);
    });
    const timer = setTimeout(() => setWaited(true), 4000); // if nothing happened by now, the link is bad
    return () => {
      data.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMessage("Use at least 8 characters.");
    if (password !== confirm) return setMessage("The two passwords do not match.");
    setBusy(true);
    setMessage("");
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMessage(error.message);
    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Brain size={20} />
          </span>
          <h1>Choose a new password</h1>
        </div>

        {ready ? (
          <form onSubmit={save} className="card card-body grid gap-4">
            <div>
              <label className="label" htmlFor="pw">New password</label>
              <input id="pw" type="password" autoComplete="new-password" className="input" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="pw2">Confirm new password</label>
              <input id="pw2" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {message && <p className="alert-error">{message}</p>}
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving..." : "Save password"}
            </button>
          </form>
        ) : waited ? (
          <div className="card card-body grid gap-4 text-center">
            <p className="alert-error">This reset link is invalid or has expired, or it was opened in a different browser than the one you requested it from.</p>
            <Link href="/login" className="btn-primary">
              Back to login
            </Link>
          </div>
        ) : (
          <p className="text-center text-ink-muted">Checking your reset link...</p>
        )}
      </div>
    </main>
  );
}
