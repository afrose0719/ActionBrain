"use client";

import { useEffect, useState } from "react";

/** True when the person asked the system to reduce motion. Animations then jump straight to their end state. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/**
 * The ActionBrain mark: a check (a commitment kept) on a teal tile, with an amber spark (ActionBrain noticed it).
 * The check draws itself once when the mark appears; with `alive` the spark twinkles (use it only while work is happening).
 */
export function Logo({ size = 28, alive = false, className = "" }: { size?: number; alive?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="ActionBrain" className={className}>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--color-brand-600)" />
      <path
        d="M8.5 16.5 L13.5 21.5 L23 11"
        fill="none"
        stroke="var(--color-on-brand)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="24"
        strokeDashoffset="24"
        className="animate-draw"
      />
      <path
        d="M25 3.5 L26.2 6.8 L29.5 8 L26.2 9.2 L25 12.5 L23.8 9.2 L20.5 8 L23.8 6.8 Z"
        fill="var(--color-amber)"
        className={alive ? "animate-twinkle" : undefined}
      />
    </svg>
  );
}

/** The mark with the name next to it. */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Logo size={size} />
      <span className="text-base font-semibold tracking-tight">
        Action<span className="text-brand-600">Brain</span>
      </span>
    </span>
  );
}

/** A number that rolls up to its value (about 0.6 s). Shows the value at once under reduce motion. */
export function CountUp({ value, durationMs = 600 }: { value: number; durationMs?: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (reduced || value === 0) {
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, reduced]);
  return <span aria-label={String(value)}>{shown}</span>;
}

/** A ring that fills to `done` of `total` (for "today: 3 of 5 done"). The number is always written out, never colour alone. */
export function ProgressRing({ done, total, size = 56, label }: { done: number; total: number; size?: number; label: string }) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const part = total > 0 ? Math.min(1, done / total) : 0;
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(part));
    return () => cancelAnimationFrame(id);
  }, [part]);
  return (
    <span className="relative inline-flex items-center justify-center" role="img" aria-label={`${label}: ${done} of ${total}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-brand-600)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - drawn)}
          style={{ transition: "stroke-dashoffset 700ms var(--ease-soft)" }}
        />
      </svg>
      <span className="absolute text-xs font-semibold">
        {done}/{total}
      </span>
    </span>
  );
}

/** Shimmering placeholder rows while something loads. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid gap-2">
          <div className="skeleton h-4" style={{ width: `${70 - i * 12}%` }} />
          <div className="skeleton h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
