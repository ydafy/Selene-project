---
name: selene-engineering-principles
description: "Trigger: money flows, Stripe webhooks, cron, refunds, payouts, order/shipment state, external data parsing, bug fixes, new module design. Engineering principles for Selene code."
license: MIT
metadata:
  author: "school-portal"
  version: "1.0"
  source: "Adapted from pstack (backnotprop/pstack, MIT); see LICENSE"
---

## Activation Contract

Load when the task touches money movement, Stripe webhooks, pg_cron jobs, refunds, payouts, order or shipment state, parsing of external data (Stripe, Envia, request bodies, env vars), a bug fix, or new code that crosses a module or function boundary.

Skip for copy changes, styling, and trivial edits.

## Hard Rules

- This skill supplies engineering judgment only. It never overrides the active workflow (ODD), test-first rules (TDD), the native review controller (RDD), Git policy, delegation rules, or AGENTS.md. On conflict, AGENTS.md and the harness win.
- Do not spawn extra agents, parallel candidates, multi-model panels, or reviews because of this skill.
- Apply the principles only to code the task touches; do not refactor outside the request.
- No temporary breakage or "fine for now" workarounds; production quality only.
- Idempotency first: every state-mutating step must be safe to run twice and safe after a crash at any point. Derive each step from current state, compare with the goal, apply only the difference. Prefer expiring leases over boolean locks.
- Parse external data into domain types at the boundary; keep business logic in pure functions that the handler shell calls.
- `unknown` for external data, schema (zod) before hand-written guards, no `as` except after validation, exhaustive switches, ids that mean different things get distinct types. Money stays integer cents.
- Model domain states as enums or discriminated unions from `packages/types`; never invent table, column, or enum names.
- Tests assert observable behavior, never internals. Never weaken or delete a test to get green.
- Fix root causes. A guard is a fix only when the guarded state is legitimate.

## Decision Gates

| Situation | Principle | Detail |
| --- | --- | --- |
| Touching money, webhook, or cron | Idempotency | `references/principles.md` §1 |
| Adding a state or status | Domain model | §2 |
| Parsing external input | Boundary + types | §3, §4 |
| Writing or keeping a test | Behavior tests | §5 |
| Fixing a bug | Root cause + bug-fix sequence | §6, §8 |
| Second fix failed the same check | Attack the premise | §7 |
| New cross-module code | Sketch, then red flags | §9, `references/design-red-flags.md` |

## Execution Steps

1. Match the task to the Decision Gates and read only the referenced sections.
2. For state-mutating work, answer: what if this runs twice, and what if the previous run crashed here? Test both.
3. For bugs, follow §8: reproduce on the matching surface, narrow with runtime evidence, failing test observed RED, fix, rerun the same repro.
4. For cross-boundary code, write the caller's usage first, then types and signatures, screen them against the red flags, then implement. Treat deviations from the sketch as signal. Never commit sketches or `not implemented` stubs in production paths.
5. After two failed fixes with one premise, write the premise as one sentence and test it directly before a third fix.
6. Check the touched code against the Hard Rules before handing off.

## Output Contract

Report only what applies:
- Idempotency: which steps are re-runnable and how it was tested (run twice, crash between steps).
- Bug fix: what broke, root cause, fix, verification with RED then GREEN output. "Inconclusive" or a different surface is not a pass.
- Design: red flags found in the sketch and what changed because of them.

## References

- `references/principles.md`: the nine adapted principles with Selene examples.
- `references/design-red-flags.md`: design checklist for new cross-module code.
- `LICENSE`: pstack MIT notice.
