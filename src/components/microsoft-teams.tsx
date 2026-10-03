"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, RefreshCw, ShieldCheck, Trash2, Users } from "lucide-react";
import { authFetch } from "@/lib/api";
import { isTenantDomain } from "@/lib/microsoft-client";

type Status = { configured: boolean; connected: boolean; account: string | null; connectedAt: string | null; lastSyncedAt: string | null };

/** Settings panel (Milestone 27, route B): sign in with Microsoft to bring your Teams chats into the Inbox. See docs/microsoft-teams-setup.md. */
export function MicrosoftTeams() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [domain, setDomain] = useState("");
  const [adminLink, setAdminLink] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await authFetch("/api/microsoft/status");
      if (res.ok) setStatus(await res.json());
    })();
  }, []);

  async function connect() {
    setBusy(true);
    setError("");
    const state = crypto.randomUUID();
    sessionStorage.setItem("ms_state", state); // checked again when Microsoft sends the person back
    const res = await authFetch(`/api/microsoft/connect?state=${state}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(body.error ?? "Could not start the connection.");
    }
    window.location.href = body.url;
  }

  async function syncNow() {
    setBusy(true);
    setError("");
    setNotice("");
    const res = await authFetch("/api/microsoft/sync", { method: "POST", body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Could not read Teams.");
    setNotice(
      body.stored > 0
        ? `${body.stored} new message${body.stored > 1 ? "s" : ""} added to your Inbox.`
        : body.limit > 0
          ? "The daily limit for captured messages was reached. The rest will come in tomorrow."
          : "No new messages."
    );
    const s = await authFetch("/api/microsoft/status");
    if (s.ok) setStatus(await s.json());
  }

  async function disconnect() {
    if (!confirm("Disconnect Microsoft Teams? ActionBrain forgets the sign-in. Messages already in your Inbox stay. You can also remove ActionBrain at myaccount.microsoft.com.")) return;
    setBusy(true);
    const res = await authFetch("/api/microsoft/connect", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError("Could not disconnect.");
    setStatus((s) => (s ? { ...s, connected: false, account: null, lastSyncedAt: null } : s));
    setNotice("");
  }

  async function makeAdminLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAdminLink("");
    const d = domain.trim().toLowerCase();
    if (!isTenantDomain(d)) return setError("Enter your company's domain, for example contoso.com.");
    const res = await authFetch(`/api/microsoft/admin-link?domain=${encodeURIComponent(d)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "Could not create the link.");
    setAdminLink(body.url);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(adminLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link is selectable in the box */
    }
  }

  return (
    <section className="card mb-6">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <Users size={16} className="text-brand-600" />
        <h2>Microsoft Teams (chats)</h2>
      </div>
      <div className="card-body grid gap-4">
        <p className="text-ink-muted">
          Sign in with your <strong>work or school</strong> Microsoft account and ActionBrain brings new messages from your Teams chats (one-to-one, group and meeting chats) into your Inbox.
          It can only see what you can already see, only messages from <strong>after</strong> you connect, and it never writes anything to Teams.
        </p>

        {error && <p role="alert" className="alert-error">{error}</p>}
        {notice && <p role="status" className="rounded-md border border-success-600/20 bg-success-50 px-3 py-2 text-success-600">{notice}</p>}

        {!status ? (
          <p className="text-ink-muted">Loading...</p>
        ) : !status.configured ? (
          <p className="rounded-md border border-line bg-canvas px-4 py-3 text-ink-muted">
            Not set up on this server yet. Follow <code>docs/microsoft-teams-setup.md</code>, then restart the server.
          </p>
        ) : status.connected ? (
          <div className="grid gap-3 rounded-md border border-line bg-canvas px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-success-600" />
                <span>
                  Connected{status.account ? <> as <strong>{status.account}</strong></> : null}
                  {status.lastSyncedAt ? <span className="text-ink-muted"> · newest message {new Date(status.lastSyncedAt).toLocaleString()}</span> : <span className="text-ink-muted"> · nothing imported yet</span>}
                </span>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={syncNow} disabled={busy}>
                  <RefreshCw size={14} />
                  {busy ? "Reading..." : "Sync now"}
                </button>
                <button type="button" className="btn-danger btn-sm" onClick={disconnect} disabled={busy}>
                  <Trash2 size={14} />
                  Disconnect
                </button>
              </div>
            </div>
            <p className="text-xs text-ink-muted">
              New messages are fetched when you open the Inbox, and every couple of minutes while it is open. If the ActionBrain Android app also captures Teams on your phone, switch one of the two off: both would add the same messages.
            </p>
          </div>
        ) : (
          <div>
            <button type="button" className="btn-primary" onClick={connect} disabled={busy}>
              <Link2 size={16} />
              {busy ? "Redirecting..." : "Connect Microsoft Teams"}
            </button>
            <p className="mt-2 text-xs text-ink-muted">
              ActionBrain asks Microsoft for one permission: <strong>Chat.Read</strong> (read your chats). Microsoft shows you exactly what it asks before you agree. Some organisations require an administrator to approve this once.
            </p>
          </div>
        )}

        {status?.configured && !status.connected && (
          <details className="rounded-md border border-line px-4 py-3">
            <summary className="cursor-pointer font-medium">Microsoft says an administrator must approve it? Ask your admin</summary>
            <form onSubmit={makeAdminLink} className="mt-3 grid gap-3">
              <p className="text-sm text-ink-muted">
                Enter your company&rsquo;s domain and send the link below to your Microsoft 365 administrator. They approve ActionBrain <strong>once</strong>, for everyone in the organisation, after which you (and your colleagues) can connect.
              </p>
              <div className="flex gap-2">
                <input aria-label="Your company's domain" className="input" placeholder="contoso.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
                <button className="btn-secondary shrink-0">Create link</button>
              </div>
              {adminLink && (
                <div className="flex gap-2">
                  <input readOnly aria-label="Link for your administrator" className="input font-mono text-xs" value={adminLink} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn-secondary btn-sm shrink-0" onClick={copyLink}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
              <p className="text-xs text-ink-muted">
                The link contains no secret. It names the app and the permission it asks for (read the signed-in user&rsquo;s own chats). It does not let anyone else read anything.
              </p>
            </form>
          </details>
        )}
      </div>
    </section>
  );
}
