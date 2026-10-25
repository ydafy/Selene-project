# Selene engineering principles

Adapted from pstack (backnotprop/pstack, MIT). Judgment only: AGENTS.md, ODD, TDD, RDD, and Git rules always win.

## 1. Make operations idempotent (highest priority)

For every state-mutating step ask: what if it runs twice? What if the previous run crashed at each point?

- Derive the step from current state, compare with the goal, apply only the difference. Do not replay a recorded plan.
- Leftovers (locks, claimed jobs, half-written rows) must be recognizable as stale by the next run. Prefer expiring leases over boolean locks (`fn_acquire_auto_cancel_lease` is the model; see BL13 for a boolean lock that can stick).
- Selene hot spots: `stripe-webhooks` event handling (Stripe redelivers), pg_cron HTTP jobs (retries and overlapping ticks), refunds, payout release (full shipment amount or nothing), label purchase with Envia.
- Test: run the step twice, then crash between steps and rerun. Assert the same end state and no duplicate money movement (one refund, one transfer, one label).

## 2. Model the domain

- Use state machines or discriminated unions instead of scattered booleans (`is_paid`, `is_cancelled`, `is_refunded` drifting apart).
- One module owns one body of domain knowledge (shipment lifecycle, dispute handling, payout runs), not load / validate / save stages spread across files.
- Use generated types: `Tables<'orders'>`, `Enums<'order_status_enum'>` from `packages/types`. Never invent table, column, or enum names.
- Do not force an abstraction on clear local code.

## 3. Boundary discipline

- Validate and parse at boundaries: Edge Function request bodies, Stripe event payloads, Envia responses, env vars, rows read with untyped clients. Convert into domain types there.
- Inside the boundary, trust the types. Do not re-validate the same data in every layer.
- Business logic lives in pure functions (for example `_shared/` helpers or `fee-calculator.ts`) that the handler shell calls. The shell does I/O, auth, and logging.
- Do not re-export wire types (Stripe or Envia shapes) as your domain types.

## 4. Type-system discipline (TypeScript)

- `unknown` for anything external.
- Schema first: zod (already used here), infer the type from it, before hand-written guards.
- No `as` except after validation. Prefer `satisfies`.
- Brand ids that share a primitive but mean different things (`ShipmentId` vs `OrderId`).
- Exhaustive switch: `const _exhaustive: never = x` in the default branch.
- Derive from `database.types.ts` with `Pick` / `Omit` before declaring a new interface.
- Money stays integer cents at application boundaries.

## 5. Test behavior, not implementation

- Assert what users of the code observe: return values, errors callers branch on, rows written, requests sent to Stripe or Envia, emitted notifications.
- Judge a test with two imagined edits: break the behavior (the test must fail); restructure internals (the test must pass).
- Derive expected values from the requirement, not from running the code.
- Pair every "never charges / never refunds" assertion with a case where the charge or refund does happen.
- Never weaken or delete an existing test to get green; propose a rewrite instead.

## 6. Fix root causes

- Reproduce first. Ask "why" until you reach the first wrong decision.
- Instrument instead of guessing.
- A guard is a fix only when the guarded state is legitimate. Guarding against an impossible state hides the bug that created it.
- Fails only after a restart? Suspect persisted state (rows, leases, cached config).
- Fix every instance of the same pattern within task scope.
- If the root cause was hard to find, propose a cheap always-on signal (log, Sentry tag, cron-watchdog check).

## 7. Attack the premise

After two fixes that share one premise fail the same check, write the premise as one sentence and test it directly before a third fix. Example premise: "the webhook handler runs once per event."

## 8. Bug-fix sequence

1. Reproduce on the matching surface.
   - Production report: Sentry MCP first, then Supabase logs (read-only), then reproduce on the local stack.
   - Edge Functions and RPCs: Bruno. admin-web: Playwright. Pure logic: `bun test`.
   - Ask the human only with a specific reason the tools cannot reach it.
2. Narrow the cause by eliminating hypotheses with runtime evidence.
3. Write the failing test first and observe RED.
4. Fix, then rerun the same repro. "Inconclusive" or a different surface is not a pass.

Report: what broke, root cause, fix, verification with RED then GREEN output.

## 9. Sketch before code

For work crossing a module or function boundary, single agent only:

1. Write the caller's usage first.
2. Write types and signatures.
3. Screen them against `design-red-flags.md`.
4. Implement.

Deviations from the sketch are signal. Scrap the sketch when the same workaround shape repeats, types need escape hatches, or callers must know internals. Sketches are working notes, never committed as `not implemented` stubs in production paths.
