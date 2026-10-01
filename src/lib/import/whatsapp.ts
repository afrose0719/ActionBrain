// Parses WhatsApp's "Export chat" .txt files (Android and iPhone formats). No API, no cost, nothing leaves your device.
//   Android: 31/12/2025, 21:41 - Rajesh: Can you send the RCA?
//   iPhone : [31/12/2025, 21:41:05] Rajesh: Can you send the RCA?

const DATE = String.raw`(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})`;
const TIME = String.raw`(\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?)`;
const ANDROID = new RegExp(String.raw`^${DATE},?\s+${TIME}\s+-\s+(.*)$`);
const IPHONE = new RegExp(String.raw`^\[${DATE},?\s+${TIME}\]\s+(.*)$`);
const MEDIA = /^(<media omitted>|<attached: .*>|(image|video|audio|sticker|gif|document|contact card) omitted|this message was deleted\.?|you deleted this message\.?|null)$/i;

export type WhatsAppMessage = { date: string; time: string; sender: string; text: string };

export function parseWhatsApp(raw: string): WhatsAppMessage[] {
  const clean = raw
    .replace(/^﻿/, "")
    .replace(/ /g, " ") // newer iPhones put a narrow no-break space before AM/PM
    .replace(/[‎‏‪-‮]/g, ""); // invisible direction marks

  const messages: WhatsAppMessage[] = [];
  let last: WhatsAppMessage | null = null;

  for (const line of clean.split(/\r?\n/)) {
    const m = line.match(ANDROID) ?? line.match(IPHONE);
    if (m) {
      const sender = m[3].match(/^([^:]+?):\s([\s\S]*)$/);
      if (!sender) {
        last = null; // system line such as "Messages are end-to-end encrypted" or "X joined"
        continue;
      }
      last = { date: m[1], time: m[2], sender: sender[1].trim(), text: sender[2].trim() };
      messages.push(last);
    } else if (last && line.trim()) {
      last.text += "\n" + line.trim(); // a multi-line message
    }
  }
  return messages.filter((msg) => msg.text && !MEDIA.test(msg.text));
}

/** Formats the most recent messages that fit in `maxChars`, as one block ready for the Inbox. */
export function formatWhatsApp(messages: WhatsAppMessage[], maxChars = 5800) {
  const lines = messages.map((m) => `[${m.date} ${m.time}] ${m.sender}: ${m.text}`);
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (size + lines[i].length + 1 > maxChars && kept.length > 0) break;
    kept.unshift(lines[i].slice(0, maxChars));
    size += lines[i].length + 1;
  }
  return { text: kept.join("\n"), included: kept.length, total: lines.length };
}

/** "WhatsApp Chat with Rajesh.txt" -> "Rajesh" */
export function chatNameFromFilename(filename: string) {
  const base = filename.replace(/\.[^.]+$/, "");
  return base.replace(/^WhatsApp Chat (with|-)\s*/i, "").trim() || "chat";
}
