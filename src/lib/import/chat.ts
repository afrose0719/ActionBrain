// Turns the text of an exported WhatsApp chat (.txt) or an email (.eml) into what the Inbox form should show.
// Used by the file picker AND by the Android app hand-off (a chat exported from WhatsApp and shared to ActionBrain),
// so both behave identically. Nothing here talks to a server.
import { formatEmail, parseEml } from "./email.ts";
import { chatNameFromFilename, formatWhatsApp, parseWhatsApp } from "./whatsapp.ts";

export const MAX_IMPORT = 5_000_000;
export const TOO_BIG = "That file is over 5 MB. Export a shorter chat or paste the part you need.";

export type ImportResult = { ok: true; sourceType: string; sourceRef: string; content: string; note: string } | { ok: false; error: string };

/** Turns the text of an exported WhatsApp chat (.txt) or an email (.eml) into what the form should show. */
export function importFrom(raw: string, filename: string): ImportResult {
  if (filename.toLowerCase().endsWith(".eml")) {
    const mail = parseEml(raw);
    if (!mail.body) return { ok: false, error: "I could not find any readable text in that email file." };
    const f = formatEmail(mail);
    return { ok: true, sourceType: "email", sourceRef: f.ref, content: f.text, note: "Email imported. Review it, then click Add & analyze." };
  }

  const messages = parseWhatsApp(raw);
  if (messages.length === 0) {
    return { ok: false, error: "That does not look like a WhatsApp chat export or an .eml email. You can still paste the text below." };
  }
  const f = formatWhatsApp(messages);
  return {
    ok: true,
    sourceType: "whatsapp",
    sourceRef: `WhatsApp chat with ${chatNameFromFilename(filename)}`,
    content: f.text,
    note:
      f.included < f.total
        ? `Imported the most recent ${f.included} of ${f.total} messages (the limit is about 6,000 characters). Review, then click Add & analyze.`
        : `Imported all ${f.total} messages. Review, then click Add & analyze.`,
  };
}
