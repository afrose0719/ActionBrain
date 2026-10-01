"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Brain } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { safeNextPath } from "@/lib/navigation";

// After logging in, go back to the page the user was trying to open (only ever a safe path on this site).
function nextPath() {
  try {
    const saved = sessionStorage.getItem("after_login");
    sessionStorage.removeItem("after_login");
    return safeNextPath(saved) ?? "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  function validate() {
    if (!email.trim() || password.length < 6) {
      setMessage("Enter your email and a password of at least 6 characters.");
      return false;
    }
    return true;
  }

  async function signUp() {
    if (!validate()) return;
    if (password.length < 8) return setMessage("Choose a password with at least 8 characters.");
    setBusy(true);
    const { data, error } = await createClient().auth.signUp({ email: email.trim(), password });
    setBusy(false);
    if (error) return setMessage(error.message);
    if (data.session) return router.push(nextPath());
    setMessage("");
    setInfo("Account created. Check your email to confirm, then log in.");
  }

  async function forgotPassword() {
    if (!email.trim()) return setMessage("Enter your email above first, then click “Forgot password?”.");
    setBusy(true);
    await createClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    // Same message whether or not the account exists, so nobody can use this form to find out who has an account.
    setMessage("");
    setInfo("If an account exists for that email, a reset link is on its way. Open it in this same browser.");
  }

  async function logIn(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    const { error } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setMessage(error.message);
    router.push(nextPath());
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Brain size={20} />
          </span>
          <h1>Welcome to ActionBrain</h1>
          <p className="page-subtitle">Log in or create an account to continue.</p>
        </div>

        <form onSubmit={logIn} className="card card-body grid gap-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {message && <p className="alert-error">{message}</p>}
          {info && !message && (
            <p className="rounded-md border border-success-600/20 bg-success-50 px-3 py-2 text-success-600">{info}</p>
          )}

          <button className="btn-primary" disabled={busy}>
            Log in
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={signUp}>
            Create account
          </button>
          <button type="button" className="text-center text-xs text-ink-muted hover:text-ink" disabled={busy} onClick={forgotPassword}>
            Forgot password?
          </button>
        </form>
      </div>
    </main>
  );
}
