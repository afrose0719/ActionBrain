"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { Commitment, Suggestion, Task } from "@/lib/types";

type Attention = { inboxNew: number; inboxSuggestions: number; meetingsNew: number; meetingSuggestions: number; commitmentsToReview: number };

const pendingCount = (rows: { ai_suggestions: Suggestion[] }[] | null) =>
  (rows ?? []).reduce((n, r) => n + r.ai_suggestions.filter((s) => s.state === "pending").length, 0);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="card card-body">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [attention, setAttention] = useState<Attention | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const count = { count: "exact", head: true } as const;
      const [t, c, inboxNew, inboxAnalyzed, meetingsNew, meetingsAnalyzed, toReview] = await Promise.all([
        supabase.from("tasks").select("*"),
        supabase.from("commitments").select("*").eq("status", "open"),
        supabase.from("inbox_items").select("id", count).eq("status", "new"),
        supabase.from("inbox_items").select("ai_suggestions").eq("status", "analyzed").limit(200),
        supabase.from("meetings").select("id", count).eq("status", "new"),
        supabase.from("meetings").select("ai_suggestions").eq("status", "analyzed").limit(200),
        supabase.from("commitments").select("id", count).eq("status", "suggested"),
      ]);
      setAttention({
        inboxNew: inboxNew.count ?? 0,
        inboxSuggestions: pendingCount(inboxAnalyzed.data as { ai_suggestions: Suggestion[] }[] | null),
        meetingsNew: meetingsNew.count ?? 0,
        meetingSuggestions: pendingCount(meetingsAnalyzed.data as { ai_suggestions: Suggestion[] }[] | null),
        commitmentsToReview: toReview.count ?? 0,
      });
      setCommitments((c.data as Commitment[]) ?? []);
      setTasks((t.data as Task[]) ?? []);
    })();
  }, []);

  if (tasks === null) return <p className="text-ink-muted">Loading...</p>;

  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const open = tasks.filter((t) => t.status === "todo");
  const overdue = open.filter((t) => t.due_date && new Date(t.due_date) < now);
  const dueToday = open.filter((t) => t.due_date && new Date(t.due_date) >= now && new Date(t.due_date) <= endOfToday);
  const done = tasks.filter((t) => t.status === "done");
  const upcoming = [...overdue, ...dueToday].slice(0, 6);

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const attentionRows = attention
    ? [
        { n: attention.commitmentsToReview, label: `${plural(attention.commitmentsToReview, "commitment", "commitments")} to review`, href: "/commitments" },
        { n: attention.inboxSuggestions, label: `${plural(attention.inboxSuggestions, "suggested task", "suggested tasks")} from your inbox`, href: "/inbox" },
        { n: attention.meetingSuggestions, label: `${plural(attention.meetingSuggestions, "suggested task", "suggested tasks")} from meetings`, href: "/meetings" },
        { n: attention.inboxNew, label: `${plural(attention.inboxNew, "message", "messages")} waiting to be analyzed`, href: "/inbox" },
        { n: attention.meetingsNew, label: `${plural(attention.meetingsNew, "meeting", "meetings")} waiting to be analyzed`, href: "/meetings" },
      ].filter((r) => r.n > 0)
    : [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{greeting()}</h1>
          <p className="page-subtitle">Here is what needs your attention.</p>
        </div>
        <Link href="/tasks" className="btn-primary">
          Manage tasks
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Open tasks" value={open.length} />
        <Stat label="Due today" value={dueToday.length} tone="text-warning-600" />
        <Stat label="Overdue" value={overdue.length} tone="text-danger-600" />
        <Stat label="My commitments" value={commitments.filter((c) => c.direction === "mine").length} />
        <Stat label="Waiting for" value={commitments.filter((c) => c.direction === "theirs").length} />
        <Stat label="Completed" value={done.length} tone="text-success-600" />
      </div>

      <section className="card mt-6">
        <div className="border-b border-line px-5 py-4">
          <h2>Needs your attention</h2>
        </div>
        {attentionRows.length === 0 ? (
          <p className="card-body flex items-center gap-2 text-ink-muted">
            <CheckCircle2 size={16} className="text-success-600" />
            You are all caught up. Nothing is waiting for your review.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {attentionRows.map((r) => (
              <li key={r.label}>
                <Link href={r.href} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-canvas">
                  <span className="flex items-center gap-3">
                    <span className="badge-brand min-w-6 justify-center">{r.n}</span>
                    {r.label}
                  </span>
                  <ArrowRight size={14} className="text-ink-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-6">
        <div className="border-b border-line px-5 py-4">
          <h2>Today &amp; overdue</h2>
        </div>
        {upcoming.length === 0 ? (
          <p className="card-body text-ink-muted">Nothing due. Add tasks from the Tasks page.</p>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <span className="font-medium">{t.title}</span>
                <span className="flex items-center gap-3">
                  <span className={`badge-${t.priority}`}>{t.priority}</span>
                  <span className="text-xs text-ink-muted">{new Date(t.due_date!).toLocaleString()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
