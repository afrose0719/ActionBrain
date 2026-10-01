# Accessibility

Target: **WCAG 2.2 level AA**. This page records what is enforced automatically, what was audited by hand, and what has **not** been tested.

## Enforced on every commit (fails CI if broken)
| Guard | What it protects | Where |
|---|---|---|
| **Color-contrast tests** | Every text/background pair in the design (19 of them) must reach 4.5:1, and form-field borders 3:1. The test reads the real `globals.css`, so changing a color can't silently break readability. | `tests/a11y.test.mts` |
| **Full `jsx-a11y` lint rules** | A clickable `<div>`, an `<img>` without `alt`, a link with no destination, a button with no accessible name. | `eslint.config.mjs` |

Colors live in one place (`@theme` in `src/app/globals.css`). If you change one, run `npm test`.

## What was built in
- **Skip link** ("Skip to main content"): first Tab stop; jumps past the navigation.
- **Landmarks:** one `<main>`, a labelled `<nav>`, a banner; `aria-current="page"` marks the current page.
- **Distinct page titles** ("Tasks · ActionBrain", ...), so tabs, history and screen readers can tell pages apart.
- **Announcements:** error messages use `role="alert"`; success messages use `role="status"`.
- **Visible keyboard focus** on every control (one global rule). The app has no custom pop-up dialogs, so there is nothing to trap focus; confirmations use the browser's own dialogs.
- **Reduced motion:** animations and smooth scrolling are turned off when the operating system asks.
- **Every field has a real `<label>`**; icon-only buttons have `aria-label`s.
- **No autofocus** (it disorients screen-reader users).
- The viewport allows pinch-zoom.

## Audit results (2026-10-01)
Tool: **axe-core 4.13.0** (rules: WCAG 2.0/2.1/2.2 A and AA, plus best practices), run in a real browser.

| Page | State | Result |
|---|---|---|
| Login | default | 0 violations |
| Reset password | invalid-link message shown | 0 violations |
| 404 | default | 0 violations |
| Dashboard, Tasks, Inbox, Commitments, Waiting For, Search, Settings | default (inside the real app shell) | 0 violations |
| Meetings | default | 0 violations (1 "needs review": a button axe could not sample because another layer overlapped it; same style as the rest, measured at 6.3:1) |
| Tasks, Commitments, Waiting For, Meetings | **form open** | 0 violations |

Manual keyboard check, with real key presses: the first **Tab** reaches the skip link, it slides into view with a visible outline, and **Enter** moves focus into `<main>`.

Before this work, **9 of the 17 color pairs failed AA** (timestamps at 2.5:1, amber and green status text at about 3:1, input borders nearly invisible). They were fixed by darkening the tokens.

## Not tested: please do these before a public launch
- **Real screen readers** (NVDA or JAWS on Windows, VoiceOver on Mac and iPhone, TalkBack on Android). axe finds markup problems, but cannot judge whether the experience is *understandable*.
- **Zoom to 200% / 400%** and text-spacing overrides.
- **Windows High Contrast / forced colors.**
- **Voice control** (Dragon, Voice Access).
- **Pages that need data:** the audit used empty states. Lists with real tasks, the AI preview panel and suggestion cards use the same components, but were not audited with data.
- There is **no dark mode**. The app is light-only.

## How to re-run the automated audit
`npm test` and `npm run lint` cover the always-on guards. For a browser audit with axe:
1. `npm install --no-save axe-core`, then copy `node_modules/axe-core/axe.min.js` into `public/` **temporarily** (the Content-Security-Policy correctly blocks scripts from other sites).
2. Pages behind login can't be reached without credentials, so audit them with a throwaway route that renders the page inside `<AppShell>` without the login gate. Delete it afterwards.
3. In the page, load `/axe.min.js` and run `axe.run(document)`. Then delete the temporary files.
