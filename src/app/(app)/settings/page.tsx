"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, KeyRound, ShieldCheck, Smartphone, Trash2, User } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { authFetch } from "@/lib/api";
import { useInstall } from "@/lib/use-install";
import { DataControls } from "@/components/data-controls";
import { PROVIDERS, type ProviderId } from "@/lib/ai/provider";

type Saved = { provider: ProviderId; model: string | null; key_hint: string | null } | null;

const KEY_LINKS: Record<ProviderId, { url: string; label: string }> = {
  anthropic: { url: "https://console.anthropic.com/settings/keys", label: "console.anthropic.com" },
  openai: { url: "https://platform.openai.com/api-keys", label: "platform.openai.com" },
  gemini: { url: "https://aistudio.google.com/apikey", label: "aistudio.google.com" },
};

async function authHeaders() {
  const { data } = await createClient().auth.getSession();
  return { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token}` };
}

export default function SettingsPage() {
  const install = useInstall();
  const [saved, setSaved] = useState<Saved>(null);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [nameNotice, setNameNotice] = useState("");

  // Google Calendar
  const [google, setGoogle] = useState<{ configured: boolean; connected: boolean; email: string | null } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/settings/ai", { headers: await authHeaders() });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.settings) {
      setSaved(body.settings);
      setProvider(body.settings.provider);
      setModel(body.settings.model ?? "");
    } else {
      setSaved(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
      const res = await authFetch("/api/google/status");
      if (res.ok) setGoogle(await res.json());
      const { data } = await createClient().auth.getUser();
      setName((data.user?.user_metadata?.full_name as string) ?? "");
    })();
  }, [load]);

  async function connectGoogle() {
    setGoogleBusy(true);
    setGoogleError("");
    const state = crypto.randomUUID();
    sessionStorage.setItem("gcal_state", state); // checked again when Google sends the user back
    const res = await authFetch(`/api/google/connect?state=${state}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGoogleBusy(false);
      return setGoogleError(body.error ?? "Could not start the connection.");
    }
    window.location.href = body.url;
  }

  async function disconnectGoogle() {
    if (!confirm("Disconnect Google Calendar? ActionBrain will forget the access and ask Google to revoke it.")) return;
    setGoogleBusy(true);
    const res = await authFetch("/api/google/connect", { method: "DELETE" });
    setGoogleBusy(false);
    if (!res.ok) return setGoogleError("Could not disconnect.");
    setGoogle((g) => (g ? { ...g, connected: false, email: null } : g));
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await createClient().auth.updateUser({ data: { full_name: name.trim() } });
    setNameNotice(error ? error.message : "Name saved.");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: await authHeaders(),
      body: JSON.stringify({ provider, model, apiKey }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Could not save.");
    setApiKey("");
    setNotice("Key verified and saved securely.");
    load();
  }

  async function remove() {
    if (!confirm("Remove your saved AI key? The command box will stop working until you add one.")) return;
    setBusy(true);
    const res = await fetch("/api/settings/ai", { method: "DELETE", headers: await authHeaders() });
    setBusy(false);
    if (!res.ok) return setError("Could not remove the key.");
    setSaved(null);
    setModel("");
    setNotice("Key removed.");
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">Connect your own AI provider. ActionBrain never pays for or shares AI access.</p>
        </div>
      </div>

      <section className="card mb-6">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <User size={16} className="text-brand-600" />
          <h2>Profile</h2>
        </div>
        <form onSubmit={saveName} className="card-body grid gap-4">
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" className="input" placeholder="e.g. Afrose" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="mt-1.5 text-xs text-ink-muted">
              Used by AI to tell which commitments are yours when a message says &ldquo;Afrose, can you…&rdquo;.
            </p>
          </div>
          {nameNotice && <p className="text-xs text-ink-muted">{nameNotice}</p>}
          <div className="flex justify-end">
            <button className="btn-primary">Save name</button>
          </div>
        </form>
      </section>

      <section className="card mb-6">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <Smartphone size={16} className="text-brand-600" />
          <h2>Install the app</h2>
        </div>
        <div className="card-body grid gap-3">
          {install.installed ? (
            <p className="flex items-center gap-2 text-ink-muted">
              <ShieldCheck size={16} className="text-success-600" />
              ActionBrain is installed on this device.
            </p>
          ) : (
            <>
              <p className="text-ink-muted">
                Add ActionBrain to your home screen or desktop. It opens in its own window like a normal app.
                On Android you can also use <strong>Share → ActionBrain</strong> in WhatsApp, Gmail or any app to send text straight to your Inbox.
              </p>
              {install.canInstall ? (
                <div>
                  <button type="button" className="btn-primary" onClick={install.install}>
                    Install ActionBrain
                  </button>
                </div>
              ) : install.isIos ? (
                <p className="rounded-md border border-line bg-canvas px-4 py-3 text-ink-muted">
                  On iPhone or iPad: tap the <strong>Share</strong> button in Safari, then <strong>Add to Home Screen</strong>.
                </p>
              ) : (
                <p className="rounded-md border border-line bg-canvas px-4 py-3 text-ink-muted">
                  In Chrome or Edge, click the install icon at the right of the address bar, or open the browser menu and choose <strong>Install ActionBrain</strong>.
                  The app must be served over HTTPS (your deployed site, or localhost while developing).
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="card mb-6">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <CalendarDays size={16} className="text-brand-600" />
          <h2>Google Calendar</h2>
        </div>
        <div className="card-body grid gap-4">
          <p className="text-ink-muted">
            Read-only. Lets you pick a meeting from your calendar when adding a transcript. ActionBrain can view your events but never change them.
          </p>
          {googleError && <p role="alert" className="alert-error">{googleError}</p>}
          {google && !google.configured ? (
            <p className="rounded-md border border-line bg-canvas px-4 py-3 text-ink-muted">
              Not set up on this server yet. Follow <code>docs/google-calendar-setup.md</code>, then restart the server.
            </p>
          ) : google?.connected ? (
            <div className="flex items-center justify-between rounded-md border border-line bg-canvas px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-success-600" />
                <span>
                  Connected{google.email ? <> as <strong>{google.email}</strong></> : null}
                </span>
              </div>
              <button type="button" className="btn-danger btn-sm" onClick={disconnectGoogle} disabled={googleBusy}>
                <Trash2 size={14} />
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="btn-primary" onClick={connectGoogle} disabled={googleBusy || !google}>
                {googleBusy ? "Redirecting..." : "Connect Google Calendar"}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="flex items-center gap-2 border-b border-line px-5 py-4">
          <KeyRound size={16} className="text-brand-600" />
          <h2>AI provider</h2>
        </div>

        <form onSubmit={save} className="card-body grid gap-4">
          {!loading && saved && (
            <div className="flex items-center justify-between rounded-md border border-line bg-canvas px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-success-600" />
                <span>
                  Connected to <strong>{PROVIDERS[saved.provider].label}</strong> · key ending in{" "}
                  <code>{saved.key_hint}</code>
                </span>
              </div>
              <button type="button" className="btn-danger btn-sm" onClick={remove} disabled={busy}>
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="provider">Provider</label>
              <select
                id="provider"
                className="input"
                value={provider}
                onChange={(e) => setProvider(e.target.value as ProviderId)}
              >
                {Object.entries(PROVIDERS).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="model">Model (optional)</label>
              <input
                id="model"
                className="input"
                placeholder={PROVIDERS[provider].defaultModel}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="key">{saved ? "Replace API key" : "API key"}</label>
            <input
              id="key"
              type="password"
              autoComplete="off"
              className="input"
              placeholder="Paste your key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-ink-muted">
              Get a key at{" "}
              <a className="text-brand-600 underline" href={KEY_LINKS[provider].url} target="_blank" rel="noreferrer">
                {KEY_LINKS[provider].label}
              </a>
              . It is checked with one tiny request, then stored encrypted. It is never shown again.
            </p>
          </div>

          {error && <p role="alert" className="alert-error">{error}</p>}
          {notice && (
            <p role="status" className="rounded-md border border-success-600/20 bg-success-50 px-3 py-2 text-success-600">{notice}</p>
          )}

          <div className="flex justify-end">
            <button className="btn-primary" disabled={busy || !apiKey.trim()}>
              {busy ? "Verifying..." : "Verify & save"}
            </button>
          </div>
        </form>
      </section>

      <DataControls />
    </>
  );
}
