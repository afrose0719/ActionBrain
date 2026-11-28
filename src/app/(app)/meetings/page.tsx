"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, CheckCircle2, FileText, Mic, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { authFetch } from "@/lib/api";
import { cleanTranscript } from "@/lib/transcript";
import { SuggestionList } from "@/components/suggestion-list";
import { CallRecorder, type RecordingResult } from "@/components/call-recorder";
import { parseRecap } from "@/lib/recap";
import { getDesktopBridge, parseDesktopCall } from "@/lib/desktop-bridge";
import { formatDuration } from "@/lib/audio";
import { isSharedId, takeSharedFile } from "@/lib/shared-files";
import type { RawCommitment } from "@/lib/ai/actions";
import type { CalendarEvent } from "@/lib/google";
import type { Meeting, Suggestion } from "@/lib/types";

function nowForInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // form
  const [showForm, setShowForm] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [sharedFile, setSharedFile] = useState<File | null>(null);
  const [recap, setRecap] = useState<{ name: string; via: string; mins: number } | null>(null);
  const [desktopCall, setDesktopCall] = useState<{ via: string } | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(nowForInput);
  const [attendees, setAttendees] = useState("");
  const [transcript, setTranscript] = useState("");
  const [adding, setAdding] = useState(false);

  // calendar picker
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await createClient().from("meetings").select("*").order("meeting_date", { ascending: false });
    if (error) setError(error.message);
    else setMeetings(data as Meeting[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  // After-call recap from the Android app (Milestone 32): /meetings?recap=<caller>&via=<app>&mins=<n>. Opens the recorder at once.
  useEffect(() => {
    const parsed = parseRecap(window.location.search);
    if (!parsed) return;
    window.history.replaceState(null, "", "/meetings");
    const id = requestAnimationFrame(() => {
      setRecap(parsed);
      setShowRecorder(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // The Windows Call Notes helper (desktop/) opens /meetings?desktop=call&via=<app> in a hidden window when a call starts.
  useEffect(() => {
    const call = parseDesktopCall(window.location.search);
    if (!call || !getDesktopBridge()) return;
    window.history.replaceState(null, "", "/meetings");
    const id = requestAnimationFrame(() => {
      setDesktopCall(call);
      setShowRecorder(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // A call recording shared from the Android share sheet arrives as /meetings?shared=<id>. Pick it up once and open the recorder with it.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("shared");
    if (!isSharedId(id)) return;
    window.history.replaceState(null, "", "/meetings"); // so a refresh does not look for it again
    (async () => {
      const received = await takeSharedFile(id).catch(() => null);
      if (received) {
        setSharedFile(received);
        setShowRecorder(true);
      } else {
        setError("That shared recording is no longer available. Share it to ActionBrain again.");
      }
    })();
  }, []);

  async function openCalendar() {
    setShowEvents(true);
    setEventsLoading(true);
    setEventsError("");
    const res = await authFetch("/api/google/events");
    const body = await res.json().catch(() => ({}));
    setEventsLoading(false);
    if (!res.ok) return setEventsError(body.error ?? "Could not read your calendar.");
    // newest first, so the meeting you just finished is on top
    setEvents([...(body.events as CalendarEvent[])].sort((a, b) => b.start.localeCompare(a.start)));
  }

  function pickEvent(ev: CalendarEvent) {
    setTitle(ev.title);
    setAttendees(ev.attendees.join(", "));
    const d = new Date(ev.start);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    setDate(d.toISOString().slice(0, 16));
    setShowEvents(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (!file) return;
    if (file.size > 2_000_000) return setError("That file is over 2 MB. Paste the relevant part instead.");
    setError("");
    setTranscript(cleanTranscript(await file.text()));
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  async function saveMeeting(m: Meeting, patch: Partial<Meeting>) {
    const { error } = await createClient().from("meetings").update(patch).eq("id", m.id);
    if (error) setError(error.message);
    await load();
  }

  async function analyze(m: Meeting) {
    setBusyId(m.id);
    setError("");
    setNotice("");
    setNeedsKey(false);

    const res = await authFetch("/api/meetings/analyze", {
      method: "POST",
      body: JSON.stringify({
        transcript: m.transcript,
        title: m.title,
        attendees: m.attendees,
        meetingDate: new Date(m.meeting_date).toString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNeedsKey(body.code === "NO_KEY");
      setError(body.error ?? "Analysis failed.");
      return setBusyId(null);
    }

    const suggestions: Suggestion[] = body.suggestions.map((s: Omit<Suggestion, "id" | "state">) => ({
      ...s,
      id: crypto.randomUUID(),
      state: "pending",
    }));
    await saveMeeting(m, { summary: body.summary || null, decisions: body.decisions, ai_suggestions: suggestions, status: "analyzed" });

    // Commitments go to the same review queue as the Inbox uses.
    // On a re-analysis, first drop this meeting's still-unreviewed suggestions so they do not pile up.
    await createClient().from("commitments").delete().eq("source_id", m.id).eq("status", "suggested");
    const found: RawCommitment[] = body.commitments ?? [];
    let added = "";
    if (found.length > 0) {
      const { error: cErr } = await createClient()
        .from("commitments")
        .insert(
          found.map((c) => ({
            direction: c.direction,
            owner_name: c.owner_name,
            counterparty: c.counterparty,
            description: c.description,
            due_date: c.due_date,
            status: "suggested",
            source_type: "meeting",
            source_id: m.id,
            source_text: `${m.title}: ${c.quote}`,
            confidence: c.confidence,
            ai_generated: true,
          }))
        );
      if (cErr) setError(cErr.message);
      else added = ` ${found.length} commitment${found.length > 1 ? "s" : ""} waiting for your review.`;
    }
    setNotice(
      (body.truncated ? "The transcript was long, so only the first ~30,000 characters were analyzed." : "Analysis complete.") + added
    );
    setBusyId(null);
  }

  async function addMeeting(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !transcript.trim()) return setError("Add a title and a transcript.");
    setAdding(true);
    setError("");
    const { data, error } = await createClient()
      .from("meetings")
      .insert({
        title: title.trim(),
        meeting_date: new Date(date).toISOString(),
        attendees: attendees.trim() || null,
        transcript: transcript.trim(),
      })
      .select()
      .single();
    setAdding(false);
    if (error) return setError(error.message);
    setShowForm(false);
    setTitle("");
    setAttendees("");
    setTranscript("");
    setDate(nowForInput());
    await load();
    analyze(data as Meeting);
  }

  // A finished recording becomes a meeting, then goes through the same analysis as a pasted transcript.
  async function saveRecording(r: RecordingResult) {
    setError("");
    setNotice("");
    const when = r.startedAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const { data, error } = await createClient()
      .from("meetings")
      .insert({
        title: recap
          ? `${recap.via} call with ${recap.name} (recap)`
          : desktopCall
            ? `${desktopCall.via} call on ${when} (${formatDuration(r.durationSec)})`
            : `Call on ${when} (${formatDuration(r.durationSec)})`,
        meeting_date: r.startedAt.toISOString(),
        attendees: recap ? recap.name : null, // the AI then knows who "she" or "he" in the recap is
        transcript: r.text,
      })
      .select()
      .single();
    const desktop = desktopCall ? getDesktopBridge() : null;
    if (error) {
      desktop?.report("error", "Could not save the notes: " + error.message);
      return setError(error.message);
    }
    setShowRecorder(false);
    setRecap(null);
    setDesktopCall(null);
    await load();
    if (desktop) {
      await analyze(data as Meeting); // the helper closes this hidden window when it hears "saved", so finish first
      desktop.report("saved");
    } else analyze(data as Meeting);
  }

  async function createTask(m: Meeting, s: Suggestion) {
    setBusyId(s.id);
    const { error } = await createClient()
      .from("tasks")
      .insert({
        title: s.title,
        description: s.description ?? null,
        priority: s.priority,
        due_date: s.due_date,
        related_person: s.related_person ?? null,
        source_type: "meeting",
        source_id: m.id,
        source_text: `${m.title}: ${s.quote || ""}`.trim(),
        ai_generated: true,
        confidence: s.confidence,
      });
    if (error) {
      setBusyId(null);
      return setError(error.message);
    }
    await saveMeeting(m, { ai_suggestions: m.ai_suggestions.map((x) => (x.id === s.id ? { ...x, state: "created" } : x)) });
    setBusyId(null);
  }

  async function remove(m: Meeting) {
    if (!confirm(`Delete the meeting "${m.title}"? Tasks you already created from it are kept.`)) return;
    const { error } = await createClient().from("meetings").delete().eq("id", m.id);
    if (error) setError(error.message);
    else load();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Meetings</h1>
          <p className="page-subtitle">Turn a transcript into a summary, decisions, commitments and tasks.</p>
        </div>
        {!showForm && !showRecorder && (
          <div className="flex flex-wrap justify-end gap-2">
            <button className="btn-secondary" onClick={() => setShowRecorder(true)}>
              <Mic size={16} />
              Record a call
            </button>
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              <Plus size={16} />
              New meeting
            </button>
          </div>
        )}
      </div>

      {showRecorder && (
        <CallRecorder
          initialFile={sharedFile}
          recapOf={recap}
          autoCall={desktopCall}
          onTranscript={saveRecording}
          onClose={() => {
            setShowRecorder(false);
            setSharedFile(null);
            setRecap(null);
          }}
        />
      )}

      {showForm && (
        <form onSubmit={addMeeting} className="card card-body mb-6 grid gap-4">
          <div className="flex items-center justify-between">
            <h2>New meeting</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setShowForm(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div>
            <button type="button" className="btn-secondary btn-sm" onClick={openCalendar}>
              <CalendarDays size={14} />
              Fill from Google Calendar
            </button>
            {showEvents && (
              <div className="mt-3 rounded-md border border-line bg-canvas">
                {eventsLoading ? (
                  <p className="p-3 text-ink-muted">Loading your calendar...</p>
                ) : eventsError ? (
                  <p className="p-3 text-danger-600">
                    {eventsError}{" "}
                    <Link href="/settings" className="font-medium underline">
                      Open Settings
                    </Link>
                  </p>
                ) : events && events.length === 0 ? (
                  <p className="p-3 text-ink-muted">No events in the last 7 or next 7 days.</p>
                ) : (
                  <ul className="max-h-60 divide-y divide-line overflow-auto">
                    {events?.map((ev) => (
                      <li key={ev.id}>
                        <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface" onClick={() => pickEvent(ev)}>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{ev.title}</span>
                            {ev.attendees.length > 0 && <span className="block truncate text-xs text-ink-muted">{ev.attendees.join(", ")}</span>}
                          </span>
                          <span className="shrink-0 text-xs text-ink-muted">
                            {ev.allDay ? new Date(ev.start).toLocaleDateString() : new Date(ev.start).toLocaleString()}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="title">Title</label>
              <input id="title" className="input" placeholder="e.g. WATI integration sync" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="date">When</label>
              <input id="date" type="datetime-local" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="att">Attendees (optional)</label>
            <input id="att" className="input" placeholder="e.g. Rajesh, Anish, client team" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="label !mb-0" htmlFor="tx">Transcript</label>
              <label className="btn-secondary btn-sm cursor-pointer">
                <Upload size={14} />
                Upload .txt / .vtt / .srt
                <input type="file" accept=".txt,.vtt,.srt,.sbv,.md,text/plain" className="sr-only" onChange={onFile} />
              </label>
            </div>
            <textarea
              id="tx"
              className="input font-mono text-xs"
              rows={10}
              placeholder={"Paste the transcript. Speaker labels help:\nRajesh: I'll send the API details tomorrow.\nAfrose: Great, I'll check the backend dependency by Friday."}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-ink-muted">
              Teams, Zoom and Meet can export captions as .vtt or .srt. Timestamps are removed for you. About {transcript.length.toLocaleString()} characters.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={adding}>
              <Sparkles size={16} />
              {adding ? "Saving..." : "Save & analyze"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="alert-error mb-4">
          {error}{" "}
          {needsKey && (
            <Link href="/settings" className="font-medium underline">
              Open Settings
            </Link>
          )}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-md border border-success-600/20 bg-success-50 px-3 py-2 text-success-600">
          {notice}{" "}
          <Link href="/commitments" className="font-medium underline">
            Review commitments
          </Link>
        </p>
      )}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : meetings.length === 0 ? (
        <div className="card card-body text-ink-muted">No meetings yet. Click “New meeting” and paste a transcript.</div>
      ) : (
        <ul className="grid gap-4">
          {meetings.map((m) => (
            <li key={m.id} className="card">
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <h2>{m.title}</h2>
                  <p className="mt-1 text-xs text-ink-muted">
                    {new Date(m.meeting_date).toLocaleString()}
                    {m.attendees && ` · ${m.attendees}`}
                  </p>
                </div>
                <button className="btn-danger btn-sm shrink-0" onClick={() => remove(m)} aria-label="Delete meeting">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid gap-5 px-5 py-4">
                {m.status === "new" ? (
                  <div>
                    <button className="btn-secondary btn-sm" disabled={busyId === m.id} onClick={() => analyze(m)}>
                      <Sparkles size={14} />
                      {busyId === m.id ? "Analyzing..." : "Analyze with AI"}
                    </button>
                  </div>
                ) : (
                  <>
                    {m.summary && (
                      <div>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">Summary</p>
                        <p>{m.summary}</p>
                      </div>
                    )}
                    {m.decisions.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Decisions</p>
                        <ul className="grid gap-1.5">
                          {m.decisions.map((d, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success-600" />
                              <span>{d}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
                        {m.ai_suggestions.length === 0 ? "Action items" : `Action items for you (${m.ai_suggestions.filter((s) => s.state === "pending").length} to review)`}
                      </p>
                      {m.ai_suggestions.length === 0 ? (
                        <p className="text-ink-muted">No actions for you were detected.</p>
                      ) : (
                        <SuggestionList
                          suggestions={m.ai_suggestions}
                          busyId={busyId}
                          onCreate={(s) => createTask(m, s)}
                          onDismiss={(s) =>
                            saveMeeting(m, { ai_suggestions: m.ai_suggestions.map((x) => (x.id === s.id ? { ...x, state: "dismissed" } : x)) })
                          }
                          onEdit={(s) => saveMeeting(m, { ai_suggestions: m.ai_suggestions.map((x) => (x.id === s.id ? s : x)) })}
                        />
                      )}
                    </div>
                    <div>
                      <button className="btn-ghost btn-sm" disabled={busyId === m.id} onClick={() => analyze(m)}>
                        <Sparkles size={14} />
                        {busyId === m.id ? "Analyzing..." : "Re-analyze"}
                      </button>
                      <p className="mt-1 text-xs text-ink-subtle">Re-analyzing replaces the summary, decisions and suggestions. Commitments you already confirmed are kept.</p>
                    </div>
                  </>
                )}

                <details className="text-xs text-ink-muted">
                  <summary className="flex cursor-pointer items-center gap-1.5 hover:text-ink">
                    <FileText size={14} />
                    Transcript
                  </summary>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-canvas p-3 font-mono">{m.transcript}</pre>
                </details>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
