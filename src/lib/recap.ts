// After-call recap (Milestone 32): the Android app opens /meetings?recap=<caller>&via=<app>&mins=<n> after an answered call.
// Only these three values are read, and each is checked: this page can also be opened by any link.

export type Recap = { name: string; via: string; mins: number };

const APPS = new Set(["WhatsApp", "Microsoft Teams"]);

export function parseRecap(search: string): Recap | null {
  const p = new URLSearchParams(search);
  const name = (p.get("recap") ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
  const via = p.get("via") ?? "";
  const mins = Number(p.get("mins"));
  if (!name || !APPS.has(via) || !Number.isInteger(mins) || mins < 1 || mins > 600) return null;
  return { name, via, mins };
}
