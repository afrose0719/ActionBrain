"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Moon, RotateCcw, Sparkles, Sun, Undo2 } from "lucide-react";
import { CountUp, Logo, ProgressRing, SkeletonRows, useReducedMotion, Wordmark } from "@/components/brand";

// Public living style guide (Phase 32A): every token and animation, so the owner and reviewers can see and try the brand.
// The same tokens drive every screen. docs/brand.md explains the rules.

const SWATCHES = [
  ["Ink", "ink", "Text, headings"],
  ["Ink muted", "ink-muted", "Secondary text"],
  ["Action teal", "brand-600", "Buttons, links, the brand"],
  ["Teal wash", "brand-50", "Active, selected"],
  ["Amber", "amber", "ActionBrain did this (accent, never text)"],
  ["Canvas", "canvas", "Page"],
  ["Surface", "surface", "Cards"],
  ["Success", "success-600", "Done"],
  ["Warning", "warning-600", "Due soon"],
  ["Danger", "danger-600", "Overdue, delete"],
] as const;

type Theme = "system" | "light" | "dark";

export default function BrandPage() {
  const reduced = useReducedMotion();
  const [replay, setReplay] = useState(0);
  const [done, setDone] = useState(false);
  const [added, setAdded] = useState(0);
  const [count, setCount] = useState(12);
  const [theme, setTheme] = useState<Theme>("system");

  function applyTheme(next: Theme) {
    setTheme(next);
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="page-header">
        <div>
          <Wordmark size={36} />
          <h1 className="mt-4">The ActionBrain look</h1>
          <p className="page-subtitle max-w-xl">
            Calm deep ink, one confident action teal, a warm canvas, and amber for the moments ActionBrain did something for you.
            Motion is short and meaningful.
            {reduced ? " Your system asks to reduce motion, so animations are switched off here." : " Everything below can be replayed."}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1" role="group" aria-label="Theme">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              onClick={() => applyTheme(t)}
              className={`btn-sm btn ${theme === t ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-canvas"}`}
            >
              {t === "light" ? <Sun size={14} /> : t === "dark" ? <Moon size={14} /> : null}
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <section className="card card-body mb-6" aria-labelledby="mark">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="mark">The mark</h2>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setReplay((n) => n + 1)}>
            <RotateCcw size={14} /> Replay
          </button>
        </div>
        <div key={replay} className="flex flex-wrap items-end gap-8">
          <Logo size={96} alive />
          <Logo size={48} />
          <Logo size={28} />
          <Logo size={16} />
          <p className="max-w-xs text-ink-muted">
            A check (a promise kept) drawn on a teal tile, with an amber spark: ActionBrain noticed it for you. The spark twinkles only
            while work is happening.
          </p>
        </div>
      </section>

      <section className="mb-6" aria-labelledby="colour">
        <h2 id="colour" className="mb-3">Colour</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {SWATCHES.map(([name, token, use], i) => (
            <li key={token} className="card animate-rise overflow-hidden" style={{ "--i": i } as React.CSSProperties}>
              <div className="h-14 border-b border-line" style={{ background: `var(--color-${token})` }} />
              <div className="p-3">
                <p className="text-xs font-semibold">{name}</p>
                <p className="text-xs text-ink-muted">{use}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-muted">Every text colour is tested for readable contrast (WCAG AA) in light and dark.</p>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card card-body" aria-labelledby="controls">
          <h2 id="controls" className="mb-4">Buttons and fields</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary">Primary</button>
            <button type="button" className="btn-secondary">Secondary</button>
            <button type="button" className="btn-ghost">Ghost</button>
            <button type="button" className="btn-danger">Delete</button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">Press one: it answers your finger.</p>
          <label className="label mt-4" htmlFor="demo">A field</label>
          <input id="demo" className="input" placeholder="Click me: a soft teal focus ring" />
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="badge-high">high</span>
            <span className="badge-medium">medium</span>
            <span className="badge-low">low</span>
            <span className="badge-brand">Added automatically</span>
          </div>
        </section>

        <section className="card card-body" aria-labelledby="moments">
          <h2 id="moments" className="mb-4">Moments</h2>

          <div className="flex items-center justify-between gap-3 rounded-md border border-line p-3">
            <span className={done ? "text-ink-subtle line-through" : "font-medium"}>Submit the RCA</span>
            <button type="button" className={done ? "btn-secondary btn-sm" : "btn-primary btn-sm"} onClick={() => setDone((d) => !d)}>
              {done ? (
                <>
                  <Check key="done" size={14} className="animate-pop" /> Done
                </>
              ) : (
                "Complete"
              )}
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Completing a task: the check pops in.</p>

          <div key={`a${added}`} className={`mt-4 flex items-center justify-between gap-3 rounded-md border border-line p-3 ${added ? "animate-glow" : ""}`}>
            <span>
              <span className="badge-brand mr-2">
                <Sparkles size={12} className="mr-1" /> Added automatically
              </span>
              Send the logs to Priya
            </span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAdded((n) => n + 1)}>
              <Undo2 size={14} /> Undo
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">When ActionBrain adds something itself: one soft amber ring. Tap Undo to replay it.</p>

          <div className="mt-4 flex items-center gap-6">
            <ProgressRing done={Math.min(count, 5)} total={5} label="Done today" />
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                <CountUp value={count} />
              </p>
              <p className="text-xs text-ink-muted">Numbers roll up when they change.</p>
            </div>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setCount((c) => (c >= 40 ? 3 : c + 7))}>
              Change
            </button>
          </div>
        </section>

        <section className="card card-body" aria-labelledby="loading">
          <h2 id="loading" className="mb-4">Loading</h2>
          <SkeletonRows rows={3} />
          <p className="mt-3 text-xs text-ink-muted">A soft moving sheen, never a bare &quot;Loading...&quot;.</p>
        </section>

        <section className="card card-body" aria-labelledby="lists">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="lists">Lists arrive in order</h2>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setReplay((n) => n + 1)}>
              <RotateCcw size={14} /> Replay
            </button>
          </div>
          <ul key={replay} className="grid gap-2">
            {["Call the vendor", "Review the demo data", "Waiting for Vignesh: API spec"].map((t, i) => (
              <li key={t} className="card-interactive animate-rise p-3" style={{ "--i": i } as React.CSSProperties}>
                {t}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card card-body mt-6" aria-labelledby="rules">
        <h2 id="rules" className="mb-2">Motion rules</h2>
        <ul className="grid list-disc gap-1 pl-5 text-ink-muted">
          <li>Three speeds only: fast 140 ms (press, check), standard 220 ms (lift, focus), gentle 320 ms (arrivals).</li>
          <li>Only movement and fading (transform, opacity): smooth on phones, no layout jumps.</li>
          <li>Never the only signal: every change is also written in words or icons.</li>
          <li>Background work stays quiet: no animation for each captured message.</li>
          <li>&quot;Reduce motion&quot; in your system switches all of it off.</li>
        </ul>
        <Link href="/" className="btn-secondary mt-4 w-fit">
          Back to ActionBrain
        </Link>
      </section>
    </main>
  );
}
