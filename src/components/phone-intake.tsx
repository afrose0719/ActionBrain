"use client";

import { useCallback, useEffect, useState } from "react";
import { Battery, Bell, Check, Copy, Eye, MessageSquare, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { generateToken, hashToken, parseSenderList } from "@/lib/intake";
import { getAndroidBridge, parseAndroidStatus, type AndroidBridge, type AndroidStatus } from "@/lib/android-bridge";

type Intake = {
  token_hint: string | null;
  ignore_groups: boolean;
  allowed_senders: string[];
  received_count: number;
  last_received_at: string | null;
};

const COLUMNS = "token_hint, ignore_groups, allowed_senders, received_count, last_received_at";

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the value is selectable in the box */
    }
  }
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex gap-2">
        <input readOnly aria-label={label} className="input font-mono text-xs" value={value} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn-secondary btn-sm shrink-0" onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Settings panel for Milestone 22: send phone notifications (WhatsApp...) to the Inbox. See docs/whatsapp-intake.md. */
export function PhoneIntake() {
  const [intake, setIntake] = useState<Intake | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null); // only ever held in memory, shown once
  const [understood, setUnderstood] = useState(false);
  const [ignoreGroups, setIgnoreGroups] = useState(true);
  const [senders, setSenders] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Inside the ActionBrain Android app the page can hand the token to the app itself. In a normal browser this is null.
  // (read after the page has loaded, so the server's HTML and the app's first render are identical)
  const [bridge, setBridge] = useState<AndroidBridge | null>(null);
  const [phone, setPhone] = useState<AndroidStatus | null>(null);
  const [structure, setStructure] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("intake_settings").select(COLUMNS).maybeSingle();
    if (error) setError(error.message);
    const row = (data as Intake | null) ?? null;
    setIntake(row);
    if (row) {
      setIgnoreGroups(row.ignore_groups);
      setSenders(row.allowed_senders.join("\n"));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      setBridge(getAndroidBridge());
      await load();
    })();
  }, [load]);

  // keep the "this phone" status fresh while the page is open (you switch on notification access in another screen and come back)
  useEffect(() => {
    if (!bridge || !intake) return;
    const read = () => setPhone(parseAndroidStatus(bridge.status()));
    read();
    const timer = setInterval(read, 2000);
    return () => clearInterval(timer);
  }, [bridge, intake]);

  async function createToken(replacing: boolean) {
    if (replacing && !confirm("Create a new token? The old one stops working immediately, so update your phone automation.")) return;
    setBusy(true);
    setError("");
    setNotice("");
    const fresh = generateToken();
    const fields = {
      token_hash: await hashToken(fresh),
      token_hint: fresh.slice(-4),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
    const table = createClient().from("intake_settings");
    const { error } = replacing ? await table.update(fields).not("user_id", "is", null) : await table.insert(fields);
    setBusy(false);
    if (error) return setError(error.message);
    if (bridge) {
      // the app keeps the token itself, so there is nothing to copy
      const stored = bridge.saveIntake(`${window.location.origin}/api/intake`, fresh);
      if (stored) setNotice("This phone is connected. You do not need to copy anything.");
      else {
        setToken(fresh);
        setError("The app did not accept the token. Copy it below and use it in your own automation, or update the app.");
      }
    } else {
      setToken(fresh);
    }
    await load();
  }

  async function saveFilters(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const { error } = await createClient()
      .from("intake_settings")
      .update({ ignore_groups: ignoreGroups, allowed_senders: parseSenderList(senders) })
      .not("user_id", "is", null);
    setBusy(false);
    if (error) return setError(error.message);
    setNotice("Filters saved.");
    await load();
  }

  async function turnOff() {
    if (!confirm("Turn off phone message intake? The token stops working. Messages already in your Inbox stay.")) return;
    setBusy(true);
    const { error } = await createClient().from("intake_settings").delete().not("user_id", "is", null);
    setBusy(false);
    if (error) return setError(error.message);
    bridge?.clearIntake();
    setToken(null);
    setIntake(null);
    setPhone(null);
    setUnderstood(false);
  }

  const address = typeof window === "undefined" ? "" : `${window.location.origin}/api/intake`;

  return (
    <section className="card mb-6">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <MessageSquare size={16} className="text-brand-600" />
        <h2>Phone messages (WhatsApp)</h2>
      </div>
      <div className="card-body grid gap-4">
        <p className="text-ink-muted">
          {bridge ? (
            <>This phone can send each WhatsApp message to your <strong>Inbox</strong> by itself, using the ActionBrain app. Nothing becomes a task until you approve it.</>
          ) : (
            <>
              Your Android phone can send each WhatsApp notification here, using the <strong>ActionBrain Android app</strong> (<code>docs/android-app.md</code>) or an automation app
              (<code>docs/whatsapp-intake.md</code>). Messages arrive in your <strong>Inbox</strong>; nothing becomes a task until you approve it.
            </>
          )}
        </p>

        {error && <p role="alert" className="alert-error">{error}</p>}

        {loading ? (
          <p className="text-ink-muted">Loading...</p>
        ) : !intake ? (
          <>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>
                I understand this stores messages from my contacts in my ActionBrain account, and that analysing them sends their text to my own AI provider.{" "}
                <span className="text-ink-muted">(Use the filters below to limit it to people you choose.)</span>
              </span>
            </label>
            <div>
              <button type="button" className="btn-primary" disabled={busy || !understood} onClick={() => createToken(false)}>
                {busy ? "Creating..." : "Create my private link"}
              </button>
            </div>
          </>
        ) : (
          <>
            {token && !bridge && (
              <div className="grid gap-3 rounded-md border border-brand-600/30 bg-canvas p-4" role="status">
                <p className="font-medium">Copy these now. The token is shown only once; ActionBrain keeps just a scrambled copy.</p>
                <CopyBox label="Address (POST)" value={address} />
                <CopyBox label="Token (header: Authorization: Bearer ...)" value={`Bearer ${token}`} />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-canvas px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-success-600" />
                <span>
                  Active, token ending in <code>{intake.token_hint}</code> · {intake.received_count} received
                  {intake.last_received_at ? <> · last {new Date(intake.last_received_at).toLocaleString()}</> : " · nothing yet"}
                </span>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => createToken(true)}>
                  <RefreshCw size={14} />
                  New token
                </button>
                <button type="button" className="btn-danger btn-sm" disabled={busy} onClick={turnOff}>
                  <Trash2 size={14} />
                  Turn off
                </button>
              </div>
            </div>

            {bridge && (
              <div className="grid gap-3 rounded-md border border-line bg-canvas p-4">
                <p className="font-medium">This phone</p>
                {!phone ? (
                  <p className="text-ink-muted">Reading the app&rsquo;s status...</p>
                ) : (
                  <>
                    <ul className="grid gap-1.5">
                      <li className="flex items-center gap-2">
                        {phone.configured ? <Check size={16} className="text-success-600" /> : <span aria-hidden="true" className="inline-block h-4 w-4 text-center text-danger-600">!</span>}
                        {phone.configured ? "Connected to your ActionBrain." : "Not connected yet. Press New token above to connect this phone."}
                      </li>
                      <li className="flex items-center gap-2">
                        {phone.listening ? <Check size={16} className="text-success-600" /> : <span aria-hidden="true" className="inline-block h-4 w-4 text-center text-danger-600">!</span>}
                        {phone.listening ? "Notification access is on." : "Notification access is off, so no WhatsApp messages can be read yet."}
                      </li>
                      {phone.screenAvailable && (
                        <li className="flex items-center gap-2">
                          {phone.screenOn ? <Check size={16} className="text-success-600" /> : <span aria-hidden="true" className="inline-block h-4 w-4 text-center text-ink-subtle">–</span>}
                          {phone.screenOn
                            ? "Live chat reading is on: messages in a WhatsApp chat you have open are captured."
                            : "Live chat reading is off (optional). Without it, messages are captured only while you are NOT looking at that chat."}
                        </li>
                      )}
                      <li className="text-ink-muted">
                        Sent {phone.sent} · failed {phone.failed}
                        {phone.lastAt ? <> · last {new Date(phone.lastAt).toLocaleString()} ({phone.lastResult})</> : null}
                      </li>
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      {!phone.listening && (
                        <button type="button" className="btn-primary btn-sm" onClick={() => bridge.openNotificationAccess()}>
                          <Bell size={14} />
                          Allow notification access
                        </button>
                      )}
                      {phone.screenAvailable && !phone.screenOn && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => bridge.openScreenReadingSettings()}>
                          <Eye size={14} />
                          Turn on live chat reading
                        </button>
                      )}
                      {phone.screenAvailable && phone.screenOn && (
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setStructure(bridge.screenStructure() || "Nothing seen yet. Open a WhatsApp chat, then come back and press this again.")}>
                          <Eye size={14} />
                          Show what the app sees
                        </button>
                      )}
                      <button type="button" className="btn-secondary btn-sm" onClick={() => bridge.openBatterySettings()}>
                        <Battery size={14} />
                        Battery settings
                      </button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => bridge.openAppInfo()}>
                        App settings
                      </button>
                    </div>
                    {structure && (
                      <div>
                        <p className="mb-1 text-xs text-ink-muted">
                          The shape of WhatsApp&rsquo;s screen: names, positions and text <em>lengths</em> only. No message text is in it, so it is safe to send to the developer if reading does not work.
                        </p>
                        <textarea readOnly aria-label="Shape of WhatsApp's screen" className="input h-56 font-mono text-xs" value={structure} onFocus={(e) => e.target.select()} />
                      </div>
                    )}
                    <p className="text-xs text-ink-muted">
                      If Android will not let you switch on notification access, open <strong>App settings</strong>, tap the three dots, and choose <strong>Allow restricted settings</strong>. Then try again.
                      On phones that save battery aggressively, set ActionBrain to &ldquo;Unrestricted&rdquo; in Battery settings.
                    </p>
                  </>
                )}
              </div>
            )}

            <form onSubmit={saveFilters} className="grid gap-4">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={ignoreGroups} onChange={(e) => setIgnoreGroups(e.target.checked)} />
                <span>
                  Ignore group chats <span className="text-ink-muted">(best effort: groups are recognised by how WhatsApp words the notification)</span>
                </span>
              </label>
              <div>
                <label className="label" htmlFor="senders">Only these senders (optional)</label>
                <textarea
                  id="senders"
                  className="input"
                  rows={3}
                  placeholder={"One name per line, exactly as it shows in WhatsApp.\nLeave empty to accept every direct chat."}
                  value={senders}
                  onChange={(e) => setSenders(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-ink-muted">This is the dependable filter. Anyone not listed is dropped before it is saved.</p>
              </div>
              {notice && <p role="status" className="rounded-md border border-success-600/20 bg-success-50 px-3 py-2 text-success-600">{notice}</p>}
              <div className="flex justify-end">
                <button className="btn-primary" disabled={busy}>Save filters</button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
