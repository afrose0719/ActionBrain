"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/api";

// Google sends the browser back here with ?code=...&state=... after the user approves access.
export default function GoogleCallbackPage() {
  const router = useRouter();
  const ran = useRef(false); // the code works only once, so never run this twice (React dev mode re-runs effects)
  const [error, setError] = useState("");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const expected = sessionStorage.getItem("gcal_state");
      sessionStorage.removeItem("gcal_state");

      if (params.get("error")) {
        return setError(params.get("error") === "access_denied" ? "You cancelled the Google permission screen." : "Google returned an error.");
      }
      // The state value proves this request started from our own Settings page (blocks forged callbacks).
      if (!expected || params.get("state") !== expected) {
        return setError("The security check failed. Please start the connection again from Settings.");
      }
      const code = params.get("code");
      if (!code) return setError("Google did not send a code.");

      const res = await authFetch("/api/google/connect", { method: "POST", body: JSON.stringify({ code }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? "Could not connect Google Calendar.");
      router.replace("/settings");
    })();
  }, [router]);

  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      {error ? (
        <>
          <p className="alert-error">{error}</p>
          <Link href="/settings" className="btn-primary mt-4">
            Back to Settings
          </Link>
        </>
      ) : (
        <p className="text-ink-muted">Connecting Google Calendar...</p>
      )}
    </div>
  );
}
