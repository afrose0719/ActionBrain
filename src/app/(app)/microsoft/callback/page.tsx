"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/api";
import { friendlyAuthError } from "@/lib/microsoft-client";

// Microsoft sends the browser back here after the person approves (or refuses): ?code=...&state=... or ?error=...
// (An administrator who approves the app for everyone lands on the separate, public /microsoft-approved page instead.)
export default function MicrosoftCallbackPage() {
  const router = useRouter();
  const ran = useRef(false); // the code works only once, so never run this twice (React dev mode re-runs effects)
  const [error, setError] = useState("");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const expected = sessionStorage.getItem("ms_state");
      sessionStorage.removeItem("ms_state");

      if (params.get("error")) return setError(friendlyAuthError(params.get("error"), params.get("error_description")).message);

      // The state value proves this request started from our own Settings page (blocks forged callbacks).
      if (!expected || params.get("state") !== expected) {
        return setError("The security check failed. Please start the connection again from Settings.");
      }
      const code = params.get("code");
      if (!code) return setError("Microsoft did not send a code.");

      const res = await authFetch("/api/microsoft/connect", { method: "POST", body: JSON.stringify({ code }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body.error ?? "Could not connect Microsoft Teams.");
      router.replace("/settings");
    })();
  }, [router]);

  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      {error ? (
        <>
          <p role="alert" className="alert-error">{error}</p>
          <Link href="/settings" className="btn-primary mt-4">
            Back to Settings
          </Link>
        </>
      ) : (
        <p className="text-ink-muted">Connecting Microsoft Teams...</p>
      )}
    </div>
  );
}
