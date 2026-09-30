"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function signUp() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return setMessage(error.message);
    if (data.session) return router.push("/dashboard");
    setMessage("Account created. Check your email to confirm, then log in.");
  }

  async function logIn() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setMessage(error.message);
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
      <h1 className="text-2xl font-bold">Log in to ActionBrain</h1>
      <input
        className="rounded border p-2"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="rounded border p-2"
        type="password"
        placeholder="Password (min 6 characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button className="rounded bg-black p-2 text-white" onClick={logIn}>
        Log in
      </button>
      <button className="rounded border p-2" onClick={signUp}>
        Sign up
      </button>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </main>
  );
}
