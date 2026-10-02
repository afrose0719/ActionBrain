import { test } from "node:test";
import assert from "node:assert/strict";
import { importFrom, MAX_IMPORT } from "../src/lib/import/chat.ts";

// What WhatsApp's "Export chat -> Without media" really produces on Android: one file, one line per message.
const ANDROID_EXPORT = [
  "02/10/2026, 10:15 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.",
  "02/10/2026, 10:16 - Rajesh: hi how are you",
  "02/10/2026, 10:16 - You: good, you?",
  "02/10/2026, 10:20 - Rajesh: Can you send me the updated proposal by Friday?",
  "02/10/2026, 10:21 - You: Sure, I will send it tomorrow morning",
  "02/10/2026, 10:22 - Rajesh: <Media omitted>",
  "02/10/2026, 10:25 - Rajesh: And please share",
  "the QA results too",
].join("\n");

function ok(result: ReturnType<typeof importFrom>) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result as Extract<typeof result, { ok: true }>;
}

test("a WhatsApp Android export becomes a whatsapp Inbox item with the chat name", () => {
  const r = ok(importFrom(ANDROID_EXPORT, "WhatsApp Chat with Rajesh.txt"));
  assert.equal(r.sourceType, "whatsapp");
  assert.equal(r.sourceRef, "WhatsApp chat with Rajesh");
  assert.match(r.note, /Imported all 5 messages/); // 5 real messages: the encryption notice and the photo placeholder do not count
});

test("every line keeps its own time stamp and sender, so 'tomorrow' can be dated", () => {
  const { content } = ok(importFrom(ANDROID_EXPORT, "WhatsApp Chat with Rajesh.txt"));
  assert.ok(content.includes("[02/10/2026 10:20] Rajesh: Can you send me the updated proposal by Friday?"));
  assert.ok(content.includes("[02/10/2026 10:21] You: Sure, I will send it tomorrow morning"));
});

test("system lines and media placeholders are dropped, multi-line messages are joined", () => {
  const { content } = ok(importFrom(ANDROID_EXPORT, "chat.txt"));
  assert.ok(!content.includes("end-to-end encrypted"));
  assert.ok(!content.includes("Media omitted"));
  assert.ok(content.includes("And please share\nthe QA results too"));
});

test("an iPhone export works the same way", () => {
  const r = ok(importFrom("[02/10/2026, 10:20:05] Priya: Please update the deck by Monday\n", "WhatsApp Chat - Priya.txt"));
  assert.equal(r.sourceRef, "WhatsApp chat with Priya");
  assert.ok(r.content.includes("Priya: Please update the deck by Monday"));
});

test("a long chat keeps the most recent messages and says so", () => {
  const lines = Array.from({ length: 400 }, (_, i) => `02/10/2026, 10:${String(i % 60).padStart(2, "0")} - Rajesh: message number ${i} with some padding text to take up space`);
  const r = ok(importFrom(lines.join("\n"), "WhatsApp Chat with Rajesh.txt"));
  assert.match(r.note, /most recent \d+ of 400 messages/);
  assert.ok(r.content.length <= 6000);
  assert.ok(r.content.includes("message number 399"));
  assert.ok(!r.content.includes("message number 0 "));
});

test("text that is not a WhatsApp chat is refused with a helpful message", () => {
  for (const raw of ["", "just some words\nno chat here", "{\"json\": true}"]) {
    const r = importFrom(raw, "notes.txt");
    assert.equal(r.ok, false, raw);
    assert.match((r as { error: string }).error, /does not look like a WhatsApp chat/);
  }
});

test("an .eml file is imported as an email", () => {
  const eml = ["From: Anish <anish@example.com>", "To: me@example.com", "Subject: RCA", "Content-Type: text/plain; charset=utf-8", "", "Can you send the RCA document by Friday?"].join("\r\n");
  const r = ok(importFrom(eml, "RCA.eml"));
  assert.equal(r.sourceType, "email");
  assert.ok(r.content.includes("RCA document"));
});

test("an .eml with no readable body is refused", () => {
  const r = importFrom("From: a@b.c\r\nSubject: empty\r\n\r\n", "empty.eml");
  assert.equal(r.ok, false);
});

test("the size limit is the same 5 MB the picker uses", () => {
  assert.equal(MAX_IMPORT, 5_000_000);
});
