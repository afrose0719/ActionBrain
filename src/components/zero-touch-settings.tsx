"use client";

import { useCallback, useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { getAndroidBridge } from "@/lib/android-bridge";

type Flags = { auto_analyze: boolean; auto_create: boolean };
type Pending = "analyze" | "create" | null;

export const DAILY_LIMIT = 50;

/**
 * Zero-touch (Milestone 29): two switches, both OFF by default (review rounds 4-5). Turning one on first shows what it does
 * (prominent disclosure) and needs "Agree"; turning off is immediate and stops new background work at once.
 */
export function ZeroTouchSettings() {
  const [flags, setFlags] = useState<Flags | null>(null);
  const [state, setState] = useState<"loading" | "no_key" | "needs_sql" | "ready">("loading");
  const [used, setUsed] = useState(0);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error: e } = await supabase.from("user_ai_settings").select("auto_analyze, auto_create").maybeSingle();
    if (e) return setState(/auto_analyze|auto_create|column/i.test(e.message) ? "needs_sql" : "ready");
    if (!data) return setState("no_key");
    setFlags(data as Flags);
    setState("ready");
    const today = new Date().toISOString().slice(0, 10);
    const { data: q } = await supabase.from("ai_quota").select("used").eq("day", today).maybeSingle();
    setUsed((q as { used?: number } | null)?.used ?? 0);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  async function update(change: Partial<Flags>) {
    setError("");
    const { error: e } = await createClient().from("user_ai_settings").update(change).not("user_id", "is", null);
    if (e) return setError(e.message);
    setFlags((f) => (f ? { ...f, ...change } : f));
    setPending(null);
    // inside the Android app: let the phone know at once (it pauses for an hour after the server said "off")
    getAndroidBridge()?.autoSettingsChanged?.();
  }

  return (
    <section className="card">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <Zap size={16} className="text-brand-600" />
        <h2>Automatic (zero-touch)</h2>
      </div>
      <div className="card-body grid gap-4 text-sm">
        <p className="text-ink-muted">
          With these on, phone messages are handled while ActionBrain is closed. Both are off until you turn them on.
          Android may delay background work; it usually runs within about half an hour of a conversation going quiet.
        </p>

        {state === "loading" && <p className="text-ink-muted">Loading...</p>}
        {state === "no_key" && <p className="text-ink-muted">Add your AI provider key above first.</p>}
        {state === "needs_sql" && (
          <p role="alert" className="alert-error">The database is not ready for this yet: run supabase/milestone29-zero-touch.sql (see docs/zero-touch.md).</p>
        )}

        {state === "ready" && flags && (
          <>
            <Row
              title="Analyse automatically"
              text="Phone conversations (WhatsApp, Teams) are analysed about 10 minutes after they go quiet, without pressing Analyze. Suggestions wait in your Inbox."
              on={flags.auto_analyze}
              onTurnOn={() => setPending("analyze")}
              onTurnOff={() => update({ auto_analyze: false, auto_create: false })}
            />
            <Row
              title="Add sure items automatically"
              text="Only items the AI is sure about (90% or more, with the exact words quoted, a clear date, and a known person) become tasks or promises by themselves. Everything else waits for you."
              on={flags.auto_create}
              disabled={!flags.auto_analyze}
              onTurnOn={() => setPending("create")}
              onTurnOff={() => update({ auto_create: false })}
            />
            <p className="text-xs text-ink-muted">
              AI analyses used today: {used} of {DAILY_LIMIT}. The limit protects your AI bill; it resets every day.
            </p>
          </>
        )}

        {pending && (
          <div role="dialog" aria-label="Before you turn this on" className="rounded-md border border-line bg-canvas p-4">
            {pending === "analyze" ? (
              <p>
                <b>Before you turn this on:</b> the text of your captured phone messages will be sent automatically, in the background, to
                your AI provider using your own key, without you pressing Analyze. Your provider may charge your account (at most{" "}
                {DAILY_LIMIT} analyses a day). Nothing is sent to anyone else, and you can turn it off at any time.
              </p>
            ) : (
              <p>
                <b>Before you turn this on:</b> tasks and promises the AI is sure about will be added without asking you. They are marked
                &quot;Added automatically&quot; in your Inbox, where you can undo each one for 7 days. ActionBrain never sends a message or
                changes anything outside ActionBrain.
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button className="btn-primary btn-sm" onClick={() => update(pending === "analyze" ? { auto_analyze: true } : { auto_create: true })}>
                Agree and turn on
              </button>
              <button className="btn-secondary btn-sm" onClick={() => setPending(null)}>Not now</button>
            </div>
          </div>
        )}

        {error && <p role="alert" className="alert-error">{error}</p>}
      </div>
    </section>
  );
}

function Row(props: { title: string; text: string; on: boolean; disabled?: boolean; onTurnOn: () => void; onTurnOff: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="font-medium">{props.title}</p>
        <p className="text-ink-muted">{props.text}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.on}
        aria-label={props.title}
        disabled={props.disabled && !props.on}
        className={props.on ? "btn-primary btn-sm shrink-0" : "btn-secondary btn-sm shrink-0"}
        onClick={props.on ? props.onTurnOff : props.onTurnOn}
      >
        {props.on ? "On" : "Off"}
      </button>
    </div>
  );
}
