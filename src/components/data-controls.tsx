"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Download, FileSpreadsheet, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { authFetch } from "@/lib/api";
import { buildExport, fetchAllRows, tasksToCsv } from "@/lib/export";

function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);
// the user's own id adds nothing to their export
const withoutUserId = <T extends Record<string, unknown>>(row: T) => {
  const copy = { ...row };
  delete copy.user_id;
  return copy;
};

export function DataControls() {
  const router = useRouter();
  const [busy, setBusy] = useState<"json" | "csv" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [confirmText, setConfirmText] = useState("");

  // Reads every row (not just the first 1,000), so nothing is silently left out.
  const readAll = (table: string) => {
    const supabase = createClient();
    return fetchAllRows((from, to) =>
      supabase.from(table).select("*").order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)
    );
  };

  async function exportJson() {
    setBusy("json");
    setError("");
    try {
      const supabase = createClient();
      const [{ data: auth }, { data: ai }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from("user_ai_settings").select("provider").maybeSingle(), // never the key itself
      ]);
      const [tasks, commitments, inbox_items, meetings] = await Promise.all(
        ["tasks", "commitments", "inbox_items", "meetings"].map(readAll)
      );
      const file = buildExport({
        email: auth.user?.email ?? null,
        name: (auth.user?.user_metadata?.full_name as string | undefined) ?? null,
        aiProvider: ai?.provider ?? null,
        tables: {
          tasks: tasks.map(withoutUserId),
          commitments: commitments.map(withoutUserId),
          inbox_items: inbox_items.map(withoutUserId),
          meetings: meetings.map(withoutUserId),
        },
      });
      download(`actionbrain-export-${stamp()}.json`, JSON.stringify(file, null, 2), "application/json");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
    setBusy(null);
  }

  async function exportCsv() {
    setBusy("csv");
    setError("");
    try {
      const tasks = await readAll("tasks");
      // the leading BOM makes Excel read accents and non-Latin text correctly
      download(`actionbrain-tasks-${stamp()}.csv`, "﻿" + tasksToCsv(tasks), "text/csv;charset=utf-8");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
    setBusy(null);
  }

  async function deleteAccount() {
    setBusy("delete");
    setError("");
    const supabase = createClient();
    await authFetch("/api/google/connect", { method: "DELETE" }).catch(() => {}); // ask Google to revoke calendar access first
    const { error } = await supabase.rpc("delete_my_account");
    if (error) {
      setBusy(null);
      return setError(
        /function|schema cache|does not exist/i.test(error.message)
          ? "Account deletion is not set up yet. Run supabase/milestone17-privacy.sql in the Supabase SQL Editor."
          : error.message
      );
    }
    await supabase.auth.signOut({ scope: "local" }); // the server-side session is already gone
    router.push("/login?deleted=1");
  }

  return (
    <section className="card mt-6">
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <Database size={16} className="text-brand-600" />
        <h2>Your data</h2>
      </div>
      <div className="card-body grid gap-6">
        <div className="grid gap-3">
          <p className="text-ink-muted">
            Download everything ActionBrain stores about you: tasks, commitments, inbox messages and meetings. Your saved AI key and Google access are
            <strong> never</strong> included.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={exportJson} disabled={busy !== null}>
              <Download size={16} />
              {busy === "json" ? "Preparing..." : "Export everything (JSON)"}
            </button>
            <button className="btn-secondary" onClick={exportCsv} disabled={busy !== null}>
              <FileSpreadsheet size={16} />
              {busy === "csv" ? "Preparing..." : "Export tasks (CSV)"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-md border border-danger-600/30 bg-danger-50 p-4">
          <h2 className="text-danger-600">Delete my account</h2>
          <p className="text-ink-muted">
            Permanently deletes your account and <strong>all</strong> of your data, and cannot be undone. Consider exporting first. Revoking Google
            Calendar access is done for you.
          </p>
          <div>
            <label className="label" htmlFor="confirm-delete">Type DELETE to confirm</label>
            <input
              id="confirm-delete"
              className="input max-w-xs"
              value={confirmText}
              autoComplete="off"
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
            />
          </div>
          <div>
            <button className="btn-primary !bg-danger-600 hover:!bg-danger-600/90" onClick={deleteAccount} disabled={busy !== null || confirmText !== "DELETE"}>
              <Trash2 size={16} />
              {busy === "delete" ? "Deleting..." : "Delete my account and data"}
            </button>
          </div>
        </div>

        {error && <p className="alert-error">{error}</p>}
      </div>
    </section>
  );
}
