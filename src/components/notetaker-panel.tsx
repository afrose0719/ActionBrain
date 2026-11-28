"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Square } from "lucide-react";
import { authFetch } from "@/lib/api";
import { getDesktopBridge } from "@/lib/desktop-bridge";
import { LANGUAGES } from "@/lib/whisper/protocol";
import {
  botError,
  botRequest,
  cleanBotReply,
  HOSTED_VEXA,
  loadNotetakerPrefs,
  loadSentBots,
  meetingsToJoin,
  parseMeetingLink,
  safeBaseUrl,
  saveNotetakerPrefs,
  saveSentBots,
  speakersOf,
  transcriptText,
  type CalendarLike,
  type MeetingRef,
  type NotetakerPrefs,
  type Platform,
  type Segment,
  type SentBot,
} from "@/lib/notetaker";

export type BotNotes = { title: string; attendees: string | null; transcript: string; startedAt: Date };

type Relay = { ok: boolean; status: number; body: unknown; message?: string } | { error: string };

/** "ActionBrain Notetaker": a bot that joins Meet, Teams and Zoom like Fireflies, using the customer's own Vexa account. */
export function NotetakerPanel({ onNotes }: { onNotes: (notes: BotNotes) => Promise<void> }) {
  const [prefs, setPrefs] = useState<NotetakerPrefs>(loadNotetakerPrefs);
  const [sent, setSent] = useState<SentBot[]>(loadSentBots);
  const [state, setState] = useState<Record<string, string>>({});
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const eventsAt = useRef(0);
  const events = useRef<CalendarLike[]>([]);
  const collecting = useRef(new Set<string>());
  const notesRef = useRef(onNotes); // the latest handler, without restarting the timers on every render
  useEffect(() => {
    notesRef.current = onNotes;
  });

  const ready = Boolean(prefs.key.trim() && safeBaseUrl(prefs.baseUrl));
  const keyOf = (b: { platform: string; nativeId: string }) => `${b.platform}/${b.nativeId}`;

  const update = (next: NotetakerPrefs) => {
    setPrefs(next);
    saveNotetakerPrefs(next);
  };
  const remember = useCallback((next: SentBot[]) => {
    setSent(next);
    saveSentBots(next);
  }, []);

  // Inside the Windows helper: straight to the bot service, so transcripts never pass through ActionBrain's server.
  // In a browser: through ActionBrain's relay (the bot service does not accept calls from browsers).
  const relay = useCallback(
    async (payload: Record<string, unknown>): Promise<Relay> => {
      const full = { baseUrl: prefs.baseUrl, key: prefs.key, ...payload };
      const direct = getDesktopBridge()?.vexa;
      if (direct) {
        const r = await direct(full).catch(() => ({ error: "The helper could not reach the bot service." }));
        if ("error" in r) return r;
        return { ...r, body: r.ok ? cleanBotReply(String(payload.action), r.body) : null, message: r.ok ? undefined : botError(r.status) };
      }
      const res = await authFetch("/api/notetaker", { method: "POST", body: JSON.stringify(full) });
      return res.json().catch(() => ({ error: "The bot service answered with something unreadable." }));
    },
    [prefs.baseUrl, prefs.key]
  );

  const send = useCallback(
    async (ref: MeetingRef, title: string, eventId?: string) => {
      const r = await relay({ action: "send", bot: botRequest(ref, { botName: prefs.botName, language: prefs.language }) });
      if ("error" in r) throw new Error(r.error);
      if (!r.ok) throw new Error(r.message ?? `The bot service refused (${r.status}).`);
      const body = (r.body ?? {}) as { platform?: unknown; native_meeting_id?: unknown };
      const bot: SentBot = {
        platform: (typeof body.platform === "string" ? body.platform : ref.platform) as Platform,
        nativeId: typeof body.native_meeting_id === "string" ? body.native_meeting_id : ref.nativeId,
        meetingUrl: ref.meetingUrl,
        title,
        sentAt: Date.now(),
        eventId,
      };
      remember([...loadSentBots().filter((b) => keyOf(b) !== keyOf(bot)), bot]);
    },
    [prefs.botName, prefs.language, relay, remember]
  );

  async function sendNow() {
    setError("");
    const ref = parseMeetingLink(link);
    if (!ref) return setError("Paste a Google Meet, Microsoft Teams or Zoom meeting link.");
    setBusy(true);
    try {
      await send(ref, `${ref.platform === "google_meet" ? "Google Meet" : ref.platform === "teams" ? "Teams" : "Zoom"} meeting`);
      setLink("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the notetaker.");
    }
    setBusy(false);
  }

  async function stop(b: SentBot) {
    await relay({ action: "stop", platform: b.platform, nativeId: b.nativeId });
    setState((s) => ({ ...s, [keyOf(b)]: "Leaving the meeting; notes follow shortly" }));
  }

  // Every 45 s: which bots are still in their meeting; when one has left, collect its transcript and save it as a meeting.
  useEffect(() => {
    if (!ready || sent.length === 0) return;
    let stopped = false;
    const tick = async () => {
      const status = await relay({ action: "status" });
      if (stopped || "error" in status || !status.ok) return;
      const running = JSON.stringify(status.body ?? "");
      for (const b of loadSentBots()) {
        const k = keyOf(b);
        if (running.includes(`"${b.nativeId}"`)) {
          setState((s) => ({ ...s, [k]: "In the meeting, taking notes" }));
          continue;
        }
        if (Date.now() - b.sentAt < 90_000 || collecting.current.has(k)) continue; // just sent: may still be joining
        collecting.current.add(k);
        setState((s) => ({ ...s, [k]: "Collecting the notes..." }));
        const t = await relay({ action: "transcript", platform: b.platform, nativeId: b.nativeId });
        const segments = !("error" in t) && t.ok ? (((t.body as { segments?: Segment[] })?.segments ?? []) as Segment[]) : [];
        const text = transcriptText(segments);
        if (text) {
          await notesRef.current({ title: `${b.title} (notetaker)`, attendees: speakersOf(segments).join(", ") || null, transcript: text, startedAt: new Date(b.sentAt) });
          setState((s) => ({ ...s, [k]: "Notes saved" }));
        } else {
          setState((s) => ({ ...s, [k]: "No speech was captured (not admitted from the lobby, or nobody spoke)" }));
        }
        remember(loadSentBots().filter((x) => keyOf(x) !== k));
        collecting.current.delete(k);
      }
    };
    tick();
    const id = setInterval(tick, 45_000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [ready, sent.length, relay, remember]);

  // Auto-join: every minute, send the bot to calendar meetings that are starting (calendar re-read every 5 minutes).
  useEffect(() => {
    if (!ready || !prefs.autoJoin) return;
    const tick = async () => {
      if (Date.now() - eventsAt.current > 5 * 60_000) {
        const res = await authFetch("/api/google/events");
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return setError(body.code === "NOT_CONNECTED" ? "Auto-join needs Google Calendar: connect it in Settings." : body.error ?? "");
        events.current = body.events ?? [];
        eventsAt.current = Date.now();
      }
      const already = new Set(loadSentBots().map((b) => b.eventId).filter((x): x is string => Boolean(x)));
      for (const ev of meetingsToJoin(events.current, Date.now(), already)) {
        try {
          await send(ev.ref, ev.title, ev.id);
        } catch (e) {
          setError(`Could not send the notetaker to "${ev.title}": ${e instanceof Error ? e.message : "error"}`);
        }
      }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [ready, prefs.autoJoin, send]);

  return (
    <section className="card card-body mb-6 grid gap-3" aria-label="Meeting notetaker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2">
          <Bot size={18} className="text-brand-600" /> Meeting notetaker
        </h2>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Hide settings" : ready ? "Settings" : "Set up"}
        </button>
      </div>
      <p className="text-ink-muted">
        Sends <strong>{prefs.botName}</strong> into Google Meet, Teams or Zoom as a visible participant, like Fireflies. When it leaves,
        the speaker-labelled transcript becomes notes and tasks here. Uses your own bot account (Vexa, open source); ActionBrain keeps no
        bot key and pays nothing. Tell everyone at the start that a notetaker is in the call.
      </p>

      {open && (
        <div className="animate-rise grid gap-3 rounded-md border border-line p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="nt-base">
                Bot service
              </label>
              <input id="nt-base" className="input" value={prefs.baseUrl} onChange={(e) => update({ ...prefs, baseUrl: e.target.value })} />
              <p className="mt-1 text-xs text-ink-muted">
                {HOSTED_VEXA} (Vexa hosted, about $0.30 per meeting-hour on your own account), or your own Vexa server (https).
              </p>
            </div>
            <div>
              <label className="label" htmlFor="nt-key">
                Your Vexa key
              </label>
              <input
                id="nt-key"
                className="input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={prefs.key}
                placeholder="vxa_... from vexa.ai/account"
                onChange={(e) => update({ ...prefs, key: e.target.value.trim() })}
              />
              <p className="mt-1 text-xs text-ink-muted">Kept in this browser only, never in ActionBrain&apos;s database.</p>
              <label className="mt-1 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={Boolean(prefs.remember)}
                  onChange={(e) => update({ ...prefs, remember: e.target.checked })}
                />
                Remember on this device (needed for auto-join)
              </label>
            </div>
            <div>
              <label className="label" htmlFor="nt-name">
                Bot name
              </label>
              <input id="nt-name" className="input" value={prefs.botName} maxLength={60} onChange={(e) => update({ ...prefs, botName: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="nt-lang">
                Language
              </label>
              <select id="nt-lang" className="input" value={prefs.language ?? ""} onChange={(e) => update({ ...prefs, language: e.target.value || null })}>
                {LANGUAGES.map((l) => (
                  <option key={l.label} value={l.value ?? ""}>
                    {l.value ? l.label : "Detect for each speaker turn (best for mixed meetings)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={prefs.autoJoin} onChange={(e) => update({ ...prefs, autoJoin: e.target.checked })} />
            <span>
              Join my calendar meetings automatically
              <span className="block text-xs text-ink-muted">
                Needs Google Calendar connected in Settings, and ActionBrain open in a tab or the Windows Call Notes helper running.
              </span>
            </span>
          </label>
        </div>
      )}

      {ready && (
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="nt-link">
            Meeting link
          </label>
          <input
            id="nt-link"
            className="input min-w-0 flex-1"
            placeholder="Paste a Meet, Teams or Zoom link to send the notetaker now"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button className="btn-primary" onClick={sendNow} disabled={busy || !link.trim()}>
            <Bot size={16} />
            {busy ? "Sending..." : "Send notetaker"}
          </button>
        </div>
      )}

      {sent.length > 0 && (
        <ul className="grid gap-2">
          {sent.map((b) => (
            <li key={keyOf(b)} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-medium">{b.title}</span>
                <span className="text-xs text-ink-muted">{state[keyOf(b)] ?? "Joining (the host may need to admit it from the lobby)"}</span>
              </span>
              <button className="btn-ghost btn-sm" onClick={() => stop(b)}>
                <Square size={12} /> Stop
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="alert-error">
          {error}
        </p>
      )}
    </section>
  );
}
