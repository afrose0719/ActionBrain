# Review round 7 (27 November 2026): the automation roadmap

Reviewed: `docs/automation-roadmap.md` (8103c34) and the round-6 fixes (0f90d43). Both reviewers approved the round-6 fixes.

## Agreed by both
- **Queue first (Phase 30), then the accuracy evaluation (31)**, with auto-create off by default until 31 has run. Phase 30 is now done.
- **One automation engine** on the Milestone 29 worker model is the right foundation, not separate reminder/follow-up/summary systems.
- Motion: three short durations, transform/opacity only, everything off under reduce-motion (web: `prefers-reduced-motion`; Android:
  the system "remove animations" setting), never use motion or colour alone to carry meaning. Sources: WCAG 2.2 SC 2.3.3, MDN
  `prefers-reduced-motion`, Android accessibility settings.

## Added to the plan (nothing dropped)
| # | Addition | From | Where |
|---|---|---|---|
| A1 | **Automation Control Center**: one page with what ActionBrain may do, what it did, what failed, how to stop or undo it | ChatGPT | Phase 34 (with Activity) |
| A2 | **Release readiness gate** after Phase 33: phone test (dialogs, queue), signed Play bundle, Data safety, Chrome Web Store, Gmail Apps Script bridge | Gemini | new Phase 33R |
| A3 | `scheduled_actions`: typed action kinds only (no stored SQL, code or prompts), unique `(user_id, action_key)` such as `briefing:2026-11-28:morning`, state machine `pending → claimed → completed / failed / retry_wait / cancelled / expired`, `run_after`, `expires_at` (a morning briefing never fires at dinner), lease, attempts | both | Phase 34 |
| A4 | `activity_log` is **append-only**: action type, target table/id, evidence reference, `undo_payload`, `undone_at`; Undo adds a compensating entry instead of erasing history; short quotes only, no full message text | both | Phase 34 |
| A5 | Separate `automation_permissions` (capture, analysis, creation, notifications, external actions) | ChatGPT | Phase 34 |
| A6 | Split decision → policy check → schedule → execute → log | ChatGPT | Phase 34 |
| A7 | Missing capabilities: cross-source identity (same person in email, Teams, WhatsApp), relationship graph, rule conflict handling, learning from user corrections, delivery tracking, health monitoring, "What am I forgetting?" with evidence | ChatGPT | Phases 34-37 |
| A8 | `user_preferences` stays in `public` with normal row security; worker functions read only the columns they need | Gemini | Phase 34 |

## Where they disagreed, and the decision
**When the brand/UI work happens.**
- ChatGPT: brand **foundations** (tokens, type, motion, accessibility rules) early; Personal/Work + Today next; then apply the polish
  to the real screens, "not placeholder screens".
- Gemini: the whole brand/UI system before Personal/Work, "to avoid styling the new screens twice".
- **Decision:** ChatGPT's split satisfies both: **32A** tokens and rules first (so Phase 33's screens are built with them once),
  **33** Personal/Work + Today, **32B** apply across web, extension, Android and store pages.

**Brand colours.** ChatGPT proposes ink `#182638`, teal `#287F78`, warm canvas `#F5F3ED`, amber `#DCA85B`; Gemini proposes keeping
the current indigo `#4F46E5` with slate dark surfaces and emerald/amber/rose status colours. **This is the owner's choice**; both
must pass the contrast tests in light and dark.

## Revised order
30 ✅ queue → 31 accuracy evaluation → 32A brand foundations → 33 Personal/Work + Today + Do next → 32B brand applied everywhere →
**33R release gate (v1.0 on the stores)** → 34 engine + Control Center + Activity + briefings → 35 completion + linking →
36 follow-up drafts + meeting brief → 37 priority, deadline risk, "What am I forgetting?" → 38 decomposition.
