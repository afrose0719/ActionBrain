// The ActionBrain Call Notes helper for Windows (desktop/) opens this website and adds one object: window.ActionBrainDesktop.
// In an ordinary browser it does not exist, so these return null and nothing changes.

export type DesktopBridge = {
  isDesktop: true;
  /** The call app let go of the microphone: stop and transcribe. */
  onCallEnded(fn: () => void): void;
  /** The person skipped this call, or it was too short: throw the recording away. */
  onCallCancelled(fn: () => void): void;
  /** Progress for the helper's tray and notifications. */
  report(state: "recording" | "transcribing" | "saved" | "error", detail?: string): void;
};

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { ActionBrainDesktop?: Partial<DesktopBridge> }).ActionBrainDesktop;
  return b?.isDesktop === true && typeof b.onCallEnded === "function" && typeof b.onCallCancelled === "function" && typeof b.report === "function"
    ? (b as DesktopBridge)
    : null;
}

const APPS = new Set(["WhatsApp", "Microsoft Teams", "Zoom", "Slack", "Google Meet / browser"]); // the helper's labels (desktop/calls.cjs)

/** /meetings?desktop=call&via=<app>: the helper noticed a call. Only the two known app names are accepted. */
export function parseDesktopCall(search: string): { via: string } | null {
  const p = new URLSearchParams(search);
  const via = p.get("via") ?? "";
  return p.get("desktop") === "call" && APPS.has(via) ? { via } : null;
}
