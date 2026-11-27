import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reads the REAL stylesheet, so a future color change that breaks readability fails the build.
const css = readFileSync("src/app/globals.css", "utf8").replaceAll("\r\n", "\n");
const colours = (block: string): Record<string, string> =>
  Object.fromEntries([...block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const blockAfter = (marker: string) => {
  const start = css.indexOf("{", css.indexOf(marker)) + 1;
  return css.slice(start, css.indexOf("}", start));
};
// Light = the @theme block. Dark = light overridden by the dark block (Phase 32A). Both themes are tested below.
const tokens = colours(blockAfter("@theme"));
const darkBlock = blockAfter(':root[data-theme="dark"]');
const darkTokens = { ...tokens, ...colours(darkBlock) };

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
  ["on-brand", "brand-600", 4.5, "primary button label"],
  ["on-brand", "brand-700", 4.5, "primary button on hover"],
  ["brand-600", "canvas", 4.5, "links on the page"],
  ["danger-600", "surface", 4.5, "error text, delete buttons"],
  ["danger-600", "danger-50", 4.5, "error banner, high-priority badge"],
  ["on-brand", "danger-600", 4.5, "delete-account button label"],
  ["warning-600", "warning-50", 4.5, "medium-priority badge, warnings"],
  ["warning-600", "surface", 4.5, "due-today figure"],
  ["success-600", "success-50", 4.5, "success notices"],
  ["success-600", "surface", 4.5, "completed figure"],
  ["line-strong", "surface", 3, "form field borders"],
  ["line-strong", "canvas", 3, "form field borders on the page"],
];

for (const [theme, set] of [["light", tokens], ["dark", darkTokens]] as const) {
  for (const [fg, bg, min, where] of PAIRS) {
    test(`contrast (${theme}): ${fg} on ${bg} is at least ${min}:1 (${where})`, () => {
      assert.ok(set[fg], `token --color-${fg} not found in globals.css`);
      assert.ok(set[bg], `token --color-${bg} not found in globals.css`);
      const ratio = contrast(set[fg], set[bg]);
      assert.ok(ratio >= min, `${set[fg]} on ${set[bg]} is only ${ratio.toFixed(2)}:1 in ${theme}`);
    });
  }
}

test("the system-dark block and the manual dark switch use exactly the same colours", () => {
  const media = blockAfter(':root:not([data-theme="light"])');
  assert.deepEqual(colours(media), colours(darkBlock));
  assert.ok(Object.keys(colours(darkBlock)).length >= 18, "every colour has a dark value");
});

test("motion: three durations, and reduce-motion switches every animation and delay off", () => {
  for (const t of ["--duration-fast: 140ms", "--duration-standard: 220ms", "--duration-gentle: 320ms"]) assert.ok(css.includes(t), t);
  const reduce = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  for (const rule of ["animation-duration: 0.01ms !important", "animation-delay: 0ms !important", "transition-duration: 0.01ms !important"]) {
    assert.ok(reduce.includes(rule), rule);
  }
  // only transform and opacity are animated (smooth on phones, no layout jumps)
  const keyframes = [...css.matchAll(/@keyframes [a-z-]+ \{([\s\S]*?)\n\}/g)];
  assert.ok(keyframes.length >= 5);
  for (const kf of keyframes) {
    assert.doesNotMatch(kf[1], /\b(width|height|top|left|margin|padding):/, "keyframes must not animate layout");
  }
});

test("no hard-coded white text: filled buttons use the on-brand token (dark mode needs dark text)", () => {
  const files = ["src/app/page.tsx", "src/app/login/page.tsx", "src/components/app-shell.tsx", "src/components/brand.tsx"];
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /text-white/, f);
});

test("form fields use the stronger border, not the decorative one", () => {
  assert.match(css, /\.input\s*\{[^}]*border-line-strong/);
});
