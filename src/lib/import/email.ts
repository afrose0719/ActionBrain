// Reads a .eml file (Gmail: ⋮ → Download message; Outlook: Save as). No API, no OAuth, nothing leaves your device.

type Headers = Record<string, string>;
type Entity = { headers: Headers; body: string };

function split(raw: string): Entity {
  const m = raw.match(/\r?\n\r?\n/);
  const at = m?.index ?? raw.length;
  const headerText = raw.slice(0, at).replace(/\r?\n[ \t]+/g, " "); // unfold wrapped headers
  const headers: Headers = {};
  for (const line of headerText.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] ??= line.slice(i + 1).trim();
  }
  return { headers, body: raw.slice(at + (m?.[0].length ?? 0)) };
}

function decodeBytes(bytes: number[], charset: string) {
  try {
    return new TextDecoder(charset || "utf-8").decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  }
}

function fromQuotedPrintable(s: string, charset: string) {
  const text = s.replace(/=\r?\n/g, ""); // soft line breaks
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(text[i]));
    }
  }
  return decodeBytes(bytes, charset);
}

function fromBase64(s: string, charset: string) {
  try {
    const bin = atob(s.replace(/\s/g, ""));
    return decodeBytes(Array.from(bin, (c) => c.charCodeAt(0)), charset);
  } catch {
    return s;
  }
}

/** Decodes "=?UTF-8?B?...?=" style header values. */
function decodeWords(v: string) {
  return v
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs: string, enc: string, data: string) =>
      enc.toLowerCase() === "b" ? fromBase64(data, cs) : fromQuotedPrintable(data.replace(/_/g, " "), cs)
    );
}

function param(header: string, name: string) {
  return header.match(new RegExp(`${name}="?([^";]+)"?`, "i"))?.[1] ?? "";
}

function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeBody(e: Entity) {
  const charset = param(e.headers["content-type"] ?? "", "charset") || "utf-8";
  const enc = (e.headers["content-transfer-encoding"] ?? "").toLowerCase();
  if (enc === "quoted-printable") return fromQuotedPrintable(e.body, charset);
  if (enc === "base64") return fromBase64(e.body, charset);
  return e.body;
}

/** Returns the readable text of a message, preferring text/plain over text/html. */
function extractText(e: Entity): string {
  const ct = e.headers["content-type"] ?? "text/plain";
  if (/^multipart\//i.test(ct)) {
    const boundary = param(ct, "boundary");
    if (!boundary) return "";
    const parts = e.body
      .split(`--${boundary}`)
      .slice(1)
      .filter((p) => !p.startsWith("--"))
      .map((p) => split(p.replace(/^\r?\n/, "")))
      .filter((p) => !/attachment/i.test(p.headers["content-disposition"] ?? ""));
    const texts = parts.map((p) => ({ type: (p.headers["content-type"] ?? "text/plain").toLowerCase(), text: extractText(p) }));
    return (texts.find((t) => t.type.startsWith("text/plain") && t.text.trim()) ?? texts.find((t) => t.text.trim()))?.text ?? "";
  }
  const body = decodeBody(e);
  return /text\/html/i.test(ct) ? htmlToText(body) : body;
}

export type ParsedEmail = { from: string; to: string; subject: string; date: string; body: string };

export function parseEml(raw: string): ParsedEmail {
  const root = split(raw.replace(/^﻿/, ""));
  const h = root.headers;
  const body = extractText(root)
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith(">")) // drop quoted earlier replies
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    from: decodeWords(h["from"] ?? ""),
    to: decodeWords(h["to"] ?? ""),
    subject: decodeWords(h["subject"] ?? ""),
    date: h["date"] ?? "",
    body,
  };
}

const nameOf = (address: string) => address.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || address;

/** Text and label for an Inbox item. */
export function formatEmail(e: ParsedEmail, maxChars = 6000) {
  const text = `From: ${e.from}\nTo: ${e.to}\nDate: ${e.date}\nSubject: ${e.subject}\n\n${e.body}`.slice(0, maxChars);
  const ref = `Email from ${nameOf(e.from)}${e.subject ? `: ${e.subject}` : ""}`.slice(0, 200);
  return { text, ref };
}
