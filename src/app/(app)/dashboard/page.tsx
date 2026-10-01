"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import type { Task } from "@/lib/types";

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

  useEffect(() => {
    (async () => {
      const { data } = await createClient().from("tasks").select("*");
      setTasks((data as Task[]) ?? []);
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open tasks" value={open.length} />
        <Stat label="Due today" value={dueToday.length} tone="text-warning-600" />
        <Stat label="Overdue" value={overdue.length} tone="text-danger-600" />
        <Stat label="Completed" value={done.length} tone="text-success-600" />
      </div>

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
