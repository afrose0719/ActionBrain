# ActionBrain brand (Phase 32A)

Live style guide: **`/brand`** on the site (public): every colour, the mark, buttons, and every animation with a replay button and a
light/dark switch. Tokens live in `src/app/globals.css`; components in `src/components/brand.tsx`.

## Personality
Calm, trustworthy, quietly proactive: "You can trust ActionBrain to keep track of things, so you don't have to." Not a corporate CRM,
not a cartoon to-do app, not a glowing AI dashboard. Friendly, short words ("Caught from WhatsApp", "Waiting on Vignesh").

## The mark
A check (a promise kept) on a rounded teal tile, with a small amber spark (ActionBrain noticed it). The check draws itself once when it
appears; the spark twinkles only while work is happening (`<Logo alive />`). Readable from 16 px (extension toolbar) to 512 px (store).

## Colour (owner's choice: ink and teal, review round 7)
| Token | Light | Dark | Use |
|---|---|---|---|
| ink | `#182638` | `#e9edf1` | text, headings |
| ink-muted / ink-subtle | `#4a5565` / `#5b6675` | `#b3bcc7` / `#9aa5b3` | secondary text |
| brand-600 (action teal) | `#24756e` | `#4cbcaf` | buttons, links, the brand |
| brand-50 / brand-700 | `#e6f2f0` / `#1e635d` | `#12302d` / `#8fdcd2` | selected, badges |
| on-brand | `#ffffff` | `#0b1418` | text on filled buttons (dark mode uses dark text on light teal) |
| amber | `#dca85b` | `#e2b05f` | "ActionBrain did this": sparks, glow. Never text. |
| canvas / surface | `#f5f3ed` / `#ffffff` | `#0e161f` / `#16202b` | page / cards |
| success, warning, danger | green, amber-brown, red | lighter versions | done, due soon, overdue |

ChatGPT proposed `#287F78`; it was darkened slightly to `#24756e` so teal links pass 4.5:1 on the warm canvas. Every pair is tested in
**both themes** (`tests/a11y.test.mts`, WCAG 2.2 AA: 4.5:1 text, 3:1 field borders). Colour is never the only signal.

## Motion
| Token | Duration | Used for |
|---|---|---|
| fast | 140 ms | button press, check mark |
| standard | 220 ms | card lift, focus ring, navigation bar |
| gentle | 320 ms | things arriving (cards rise in order) |

Utilities: `animate-rise` (with `--i` for order), `animate-pop`, `animate-glow` (amber ring for automatically added items),
`animate-twinkle`, `animate-draw`, `skeleton`, `press`, `lift`, `card-interactive`. Components: `Logo`, `Wordmark`, `CountUp`,
`ProgressRing`, `SkeletonRows`, `useReducedMotion`.

Rules (both reviewers, round 7):
- Only `transform` and `opacity` move (smooth on phones, no layout jumps); a test fails if a keyframe animates layout.
- Never the only signal: every change is also in words or an icon.
- Background work is quiet: no animation per captured message.
- **Reduce motion** (system setting) makes everything instant; `CountUp` shows the number at once (WCAG 2.2 SC 2.3.3,
  MDN `prefers-reduced-motion`). Android native screens should check the system animator scale (Phase 32B).

## Where it is applied now
Home page (new: animated mark, four steps), login, reset password, app shell (wordmark, animated active-page bar), dashboard
(shimmer loading, numbers that roll up, cards in order, "done today" ring, pop when all caught up), Inbox "Added automatically"
(amber glow for today's items), every button (press), page headers and error banners (rise).

## Phase 32B (after Personal/Work + Today, as agreed in round 7)
Apply everywhere: the remaining pages, the Chrome extension popup, the Android app (icon, splash, notification icon), store graphics,
a manual theme switch in Settings, and new PNG icons generated from the mark.
