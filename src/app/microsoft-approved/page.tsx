"use client";

import { useEffect, useState } from "react";

// Where Microsoft sends an ADMINISTRATOR after they approve (or refuse) ActionBrain for their organisation.
// Public on purpose: the administrator usually has no ActionBrain account. It reads nothing and stores nothing.
export default function MicrosoftApprovedPage() {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("admin_consent")?.toLowerCase() === "true") {
        return setResult({
          ok: true,
          text: "Thank you. ActionBrain is approved for your organisation. Your colleagues can now connect Microsoft Teams from ActionBrain Settings. You can close this page.",
        });
      }
      if (params.get("error")) {
        // this page is for an administrator, so it does not use the end-user wording ("ask your admin")
        return setResult({ ok: false, text: "The approval was not completed, so nothing was changed in your organisation. You can open the link again to retry." });
      }
      setResult({ ok: false, text: "No approval was recorded. If you meant to approve ActionBrain, open the link you were sent again." });
    })();
  }, []);

  return (
    <main className="mx-auto max-w-md px-4 pt-20 text-center">
      <h1 className="mb-4">ActionBrain</h1>
      {!result ? (
        <p className="text-ink-muted">One moment...</p>
      ) : result.ok ? (
        <p role="status" className="rounded-md border border-success-600/20 bg-success-50 px-3 py-2 text-success-600">{result.text}</p>
      ) : (
        <p role="alert" className="alert-error">{result.text}</p>
      )}
    </main>
  );
}
