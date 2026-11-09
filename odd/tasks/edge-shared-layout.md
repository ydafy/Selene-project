# Edge Function shared modules by topic (#252)

Item 6 of roadmap #228. Groups `supabase/functions/_shared` by domain, moves single-module tests next to their module, and extends the kebab-case and `max-lines` lint rules to `supabase/functions`. Branch `refactor/edge-shared-layout`, stacked on `chore/remove-connect-earnings` (PR #316).

## Specs

- S1 (issue #252, Scope): "Create the subfolders `envia/`, `stripe/`, `cancellation/`, `cron/`, and `auth/`." Changed by L2 to the domain grouping in S2.
- S2 (L2, approved): the folders and their modules are:
  - `auth/`: `admin-auth`, `cron-auth`.
  - `auto-cancel/`: `auto-cancel-lease`, `auto-cancel-safety`, `auto-cancel-settings`.
  - `envia/`: `envia-carrier-cancellation`, `envia-mexico-states`, `envia-shipping`, `envia-tracking-ingestion`, `envia-tracking`, `envia-webhook-verify`.
  - `stripe/`: `stripe-charge`, `stripe-fee-gross-up`, `connect-status`, `publication-economics`.
  - `cancellation/`: `shipment-cancellation`, `cancellation-alerts`, `preparing-carrier-gate`, `refund-basis`.
  - Stay directly in `_shared/`: `sentry`, `zod-runtime`, `account-closure-cleanup`, documented as cross-cutting or single-module.
  - Each module's colocated tests (`*.test.ts`, `*.probes.test.ts`, `*.property.test.ts`) move with it.
- S3 (issue #252, Scope): "Move single-module tests from `_shared/__tests__` next to their module. Keep cross-function guards (for example the `sentry-wiring` test) where they are." The preload `_shared/__tests__/zod-runtime.bun.preload.ts` stays, so `bunfig.toml` does not change (L2).
- S4 (issue #252, Scope): "Document in `docs/conventions.md` that `supabase/migrations` and `supabase/queries` keep `__tests__/` because timestamped migrations cannot colocate their tests."
- S5 (issue #252, Scope): "Apply the root ESLint kebab-case rule and the `max-lines` warning to `supabase/functions`." By L2, the seven files whose names are not kebab-case are renamed in their own commit, without an `ignores` entry: `resolve-dispute/verdictRpc.ts`, `resolve-dispute/verdictRpc.test.ts`, and in `supabase/functions/__tests__/` `shipmentCancelSafetySourceGuards.test.ts`, `cronCancellationOutputPreservation.test.ts`, `cronCancellationCoordination.test.ts`, `autoCancelLeaseWiring.test.ts`, `autoCancelLabelDeadlineReminder.test.ts`.
- S6 (issue #252, Out of scope): "splitting `envia-shipping.ts`. It mixes address handling, quotes, config, and label-claim orchestration. Record that as an Idea issue when this item runs."
- S7 (issue #252, Done when): "`deno check --frozen */index.ts` passes in `supabase/functions`." "The test count is unchanged." "`bun run lint` passes."
- S8 (issue #252 comment, #226 research): "When a test fails after the move, fix its path. Do not delete it, weaken it, or convert it in the move commit." The 18 `toContain` assertions on `_shared/` paths get their expected path updated.
- S9 (L2): `supabase/functions/AGENTS.md` describes the new `_shared/` layout; "shared pure helpers" is no longer accurate (`envia-shipping` calls the network).

## Tasks

- [ ] T1 (S5): rename the seven non-kebab-case files with `scripts/dev/move-files.ts`. Route: worker, parent commits.
- [ ] T2 (S2, S3, S8): move the modules and their tests with `scripts/dev/move-files.ts`; fix the paths of failing tests. Route: worker, parent commits.
- [ ] T3 (S5, S7): extend the kebab-case rule and `max-lines` warning in `eslint.config.js` to `supabase/functions`, with its guard test. Route: worker, parent commits.
- [ ] T4 (S4, S9, S6): `docs/conventions.md`, `supabase/functions/AGENTS.md`, Idea issue for splitting `envia-shipping.ts`. Route: inline.
- [ ] T5 (S7): final check: `deno check --frozen`, test count equal to the baseline, `bun run lint`, `bun run format:check`, `bun run typecheck`. Route: inline.

## Log

- L1 (2026-11-08, maintainer): "Después arrancamos #252: revisá que el issue siga vigente y decime qué cambiarías antes de empezar."
- L2 (2026-11-08, maintainer): "apruebo las dos deciicones tuyas master". Approved: (1) group by domain (`auth/` with `admin-auth` and `cron-auth`; `auto-cancel/`; `envia/`; `stripe/` with `stripe-charge`, `stripe-fee-gross-up`, `connect-status`, `publication-economics`; `cancellation/` with `shipment-cancellation`, `cancellation-alerts`, `preparing-carrier-gate`, `refund-basis`; `sentry`, `zod-runtime`, `account-closure-cleanup` stay at the root), and (2) rename the camelCase files instead of an ESLint `ignores`. Also from that proposal: the preload stays, so `bunfig.toml` does not change; check `move-files` handles Deno `.ts` imports first (it does: an import that names the extension keeps it, and path strings are rewritten); update `supabase/functions/AGENTS.md`; open the Idea for `envia-shipping.ts`.
- L3 (2026-11-08): issue still holds. 22 modules, 16 tests plus the preload in `_shared/__tests__`, 17 colocated tests, 154 relative import lines to `_shared/` in 91 files outside it. Baseline on this branch (#316 included): `bun test` 5075 pass, 0 fail, 489 files.
