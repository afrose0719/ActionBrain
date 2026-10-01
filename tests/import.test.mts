import { test } from "node:test";
import assert from "node:assert/strict";
import { chatNameFromFilename, formatWhatsApp, parseWhatsApp } from "../src/lib/import/whatsapp.ts";
import { formatEmail, parseEml } from "../src/lib/import/email.ts";
import { cleanTranscript } from "../src/lib/transcript.ts";

// ---------------- WhatsApp ----------------

test("whatsapp android: drops system lines and media, joins multi-line messages", () => {
  const text = `12/30/25, 9:41 PM - Messages and calls are end-to-end encrypted.
12/30/25, 9:41 PM - Rajesh: Can you send the RCA document by Friday?
12/30/25, 9:42 PM - Afrose: Sure, I'll share it tomorrow.
I will also check the WATI dependency.
12/30/25, 9:43 PM - Rajesh: <Media omitted>
12/30/25, 9:44 PM - Rajesh joined using this group's invite link
12/31/25, 8:05 AM - Rajesh: Thanks!`;
  const m = parseWhatsApp(text);
  assert.equal(m.length, 3);
  assert.equal(m[0].sender, "Rajesh");
  assert.match(m[1].text, /I will also check the WATI dependency/);
});

test("whatsapp iphone: handles invisible marks and narrow no-break space", () => {
  const text = `‎[31/12/2025, 21:41:05] Anish: Will deploy on Monday\n[31/12/2025, 9:42:10 PM] Afrose: Great\n‎[31/12/2025, 21:43:00] Anish: image omitted`;
  const m = parseWhatsApp(text);
  assert.equal(m.length, 2);
  assert.match(m[1].time, /PM/);
});

test("whatsapp: keeps the newest messages within the size limit", () => {
  const big = Array.from({ length: 400 }, (_, n) => `12/30/25, 9:${String(n % 60).padStart(2, "0")} PM - Rajesh: message number ${n} with some padding text`).join("\n");
  const f = formatWhatsApp(parseWhatsApp(big));
  assert.ok(f.text.length <= 5800);
  assert.ok(f.included < f.total);
  assert.ok(f.text.includes("message number 399"));
  assert.ok(!f.text.includes("message number 0 "));
});

test("whatsapp: non-chat text yields no messages; filename becomes chat name", () => {
  assert.equal(parseWhatsApp("just some random notes\nnothing here").length, 0);
  assert.equal(chatNameFromFilename("WhatsApp Chat with Rajesh Kumar.txt"), "Rajesh Kumar");
});

// ---------------- Email (.eml) ----------------

test("email: plain text, quoted replies removed, label uses display name", () => {
  const eml = `From: "Rajesh Kumar" <rajesh@client.com>
To: afrose@quadrobay.com
Subject: RCA document
Date: Tue, 30 Sep 2025 10:00:00 +0530
Content-Type: text/plain; charset=utf-8

Could you send the RCA document by Friday?

> On Mon, you wrote:
> earlier quoted text

Thanks`;
  const p = parseEml(eml);
  assert.equal(p.subject, "RCA document");
  assert.match(p.body, /send the RCA document by Friday/);
  assert.ok(!p.body.includes("earlier quoted"));
  assert.equal(formatEmail(p).ref, "Email from Rajesh Kumar: RCA document");
});

test("email: decodes encoded headers and quoted-printable UTF-8", () => {
  const eml = `From: =?UTF-8?B?UmFqZXNoIEt1bWFy?= <r@x.com>
Subject: =?UTF-8?Q?Caf=C3=A9_menu_=E2=80=93_update?=
Content-Type: text/plain; charset="UTF-8"
Content-Transfer-Encoding: quoted-printable

Caf=C3=A9 prices will change =E2=80=94 please confirm by Friday. This line is a very long soft=
 wrapped line.`;
  const p = parseEml(eml);
  assert.ok(p.from.startsWith("Rajesh Kumar"));
  assert.equal(p.subject, "Café menu – update");
  assert.match(p.body, /Café prices will change — please confirm/);
  assert.match(p.body, /very long soft wrapped/);
});

test("email: base64 body, folded headers", () => {
  const eml = `Subject: A very long subject that
 continues on the next line
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: base64

${Buffer.from("I'll send the contract tomorrow. नमस्ते").toString("base64")}`;
  const p = parseEml(eml);
  assert.equal(p.subject, "A very long subject that continues on the next line");
  assert.equal(p.body, "I'll send the contract tomorrow. नमस्ते");
});

test("email: multipart prefers text/plain; html-only is stripped; attachments ignored", () => {
  const alt = `Subject: M
Content-Type: multipart/alternative; boundary="B"

--B
Content-Type: text/html; charset=utf-8

<p>HTML version</p>
--B
Content-Type: text/plain; charset=utf-8

Plain version here
--B--`;
  assert.equal(parseEml(alt).body, "Plain version here");

  const htmlOnly = `Subject: H
Content-Type: multipart/mixed; boundary="X"

--X
Content-Type: text/html; charset=utf-8

<style>p{color:red}</style><p>Please review&nbsp;the <b>draft</b> &amp; reply.</p>
--X
Content-Type: application/pdf; name="a.pdf"
Content-Disposition: attachment; filename="a.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--X--`;
  const h = parseEml(htmlOnly);
  assert.match(h.body, /Please review the draft & reply\./);
  assert.ok(!h.body.includes("JVBER"));
  assert.ok(!h.body.includes("color:red"));
});

test("email: garbage input does not throw", () => {
  assert.doesNotThrow(() => parseEml("not an email at all"));
});

// ---------------- Transcript captions ----------------

test("transcript: cleans Teams VTT (speaker tags, duplicates) and SRT", () => {
  const vtt = `WEBVTT

NOTE generated by tool

1
00:00:01.000 --> 00:00:04.000
<v Afrose>Can we ship the WATI fix on Friday?</v>

2
00:00:04.500 --> 00:00:08.000
<v Rajesh>Yes. I will send you the API details tomorrow.</v>

3
00:00:04.500 --> 00:00:08.000
<v Rajesh>Yes. I will send you the API details tomorrow.</v>
`;
  assert.equal(cleanTranscript(vtt), "Afrose: Can we ship the WATI fix on Friday?\nRajesh: Yes. I will send you the API details tomorrow.");

  const srt = `1\n00:00:01,000 --> 00:00:03,000\nAfrose: Please check the backend dependency.\n\n2\n00:00:03,500 --> 00:00:05,000\nAnish: Will do, by tomorrow.\n`;
  assert.equal(cleanTranscript(srt), "Afrose: Please check the backend dependency.\nAnish: Will do, by tomorrow.");
});

test("transcript: plain text is returned unchanged", () => {
  const plain = "Afrose: Note that this is plain text.\nRajesh: Agreed.";
  assert.equal(cleanTranscript(plain), plain);
  assert.ok(cleanTranscript("Note: ship Friday").startsWith("Note"));
});
