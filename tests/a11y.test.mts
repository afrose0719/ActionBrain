import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reads the REAL stylesheet, so a future color change that breaks readability fails the build.
const css = readFileSync("src/app/globals.css", "utf8");
const tokens: Record<string, string> = Object.fromEntries(
  [...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
);

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio, from 1 (identical) to 21 (black on white). */
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("the contrast function matches known WCAG values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#ffffff", "#ffffff").toFixed(2), "1.00");
  assert.equal(contrast("#767676", "#ffffff").toFixed(2), "4.54"); // the classic "just passes AA" gray
});

// [foreground token, background token, minimum ratio, where it appears]
// AA needs 4.5:1 for normal text and 3:1 for the edges of controls (WCAG 1.4.11).
const PAIRS: [string, string, number, string][] = [
  ["ink", "surface", 4.5, "body text"],
  ["ink", "canvas", 4.5, "body text on the page"],
  ["ink-muted", "surface", 4.5, "secondary text on cards"],
  ["ink-muted", "canvas", 4.5, "secondary text, low-priority badge"],
  ["ink-subtle", "surface", 4.5, "timestamps, completed titles, placeholders"],
  ["ink-subtle", "canvas", 4.5, "timestamps on tinted rows"],
  ["brand-600", "surface", 4.5, "links"],
  ["brand-700", "brand-50", 4.5, "brand badge, active navigation"],
  ["surface", "brand-600", 4.5, "primary button label"],
  ["surface", "brand-700", 4.5, "primary button on hover"],
  ["danger-600", "surface", 4.5, "error text, delete buttons"],
  ["danger-600", "danger-50", 4.5, "error banner, high-priority badge"],
  ["surface", "danger-600", 4.5, "delete-account button label"],
  ["warning-600", "warning-50", 4.5, "medium-priority badge, warnings"],
  ["warning-600", "surface", 4.5, "due-today figure"],
  ["success-600", "success-50", 4.5, "success notices"],
  ["success-600", "surface", 4.5, "completed figure"],
  ["line-strong", "surface", 3, "form field borders"],
  ["line-strong", "canvas", 3, "form field borders on the page"],
];

for (const [fg, bg, min, where] of PAIRS) {
  test(`contrast: ${fg} on ${bg} is at least ${min}:1 (${where})`, () => {
    assert.ok(tokens[fg], `token --color-${fg} not found in globals.css`);
    assert.ok(tokens[bg], `token --color-${bg} not found in globals.css`);
    const ratio = contrast(tokens[fg], tokens[bg]);
    assert.ok(ratio >= min, `${tokens[fg]} on ${tokens[bg]} is only ${ratio.toFixed(2)}:1`);
  });
}

test("form fields use the stronger border, not the decorative one", () => {
  assert.match(css, /\.input\s*\{[^}]*border-line-strong/);
});
