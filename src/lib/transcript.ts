const TIMESTAMP = /^(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}/;

/**
 * Turns caption files (.vtt / .srt, as exported by Teams, Zoom, Meet) into plain "Speaker: text" lines.
 * Plain text without timestamps is returned unchanged.
 */
export function cleanTranscript(raw: string): string {
  const text = raw.replace(/^﻿/, "").trim();
  if (!/-->/.test(text)) return text;

  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^WEBVTT/i.test(line) || TIMESTAMP.test(line)) continue;

    // NOTE / STYLE / REGION blocks run until the next blank line
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(line)) {
      while (i < lines.length && lines[i].trim()) i++;
      continue;
    }
    // a cue number or id sits directly above its timestamp line
    if (TIMESTAMP.test((lines[i + 1] ?? "").trim())) continue;

    const cleaned = line
      .replace(/<v\s+([^>]+)>/gi, "$1: ") // Teams: <v Anish>Hello</v>
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned && cleaned !== out[out.length - 1]) out.push(cleaned); // captions often repeat the previous line
  }
  return out.join("\n");
}
