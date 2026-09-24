# In-app notifications rebuild

## Objective
Rebuild Selene's persistent in-app notifications for MVP++ from business events, with a trustworthy server-owned inbox, an actionable visual center, and one bounded launch digest. Expo push is excluded and reserved for another session.

## Problem and rationale
Existing notifications are authored across SQL and Edge boundaries without a shared event identity; an unused pub/sub service and route-based urgency complicate the client. Source inspection found a timestamp-tie cursor bug, read-item dismiss badge decrement, and inconsistent event presentation. Preserve the useful persisted inbox, one user-scoped Realtime subscription, and owner-scoped reads, but challenge old contracts rather than keeping dead scaffolding.

## Scope and constraints
- Worktree `feat/in-app-notifications` only. Preserve main and all unrelated changes. No remote Supabase operations, deployments, generated types before maintainer confirmation, push dependencies/config, or PR/push.
- Events: confirmed order/payment (buyer and distinct sellers), seller-scoped shipment cancellation, dispute opened and final verdict, product moderation approved/approved-with-note/rejected, meaningful return evidence/delivery transitions. Defer unconfirmed timeout scheduling, legacy payout/cancellation, and tracking consumers pending evidence. Avoid duplicated per-item alerts and premature refund claims.
- Server derives recipients and stable event identities from committed business state; client owns read/dismiss state and validated navigation. Historical rows remain readable. A single launch digest has a primary action and access to other important new notices; display alone never marks read. No per-event modal queue.
- Remove replaced notification-specific code and repository SQL copies only after checking active callers; schema drops require deployed inventory/compatibility evidence and an explicit ordered migration. Maintainer executes SQL and deploys affected Edge Functions manually.
- Technical artifacts default to English, extending existing Spanish UI copy where appropriate.

## Verification and delivery
- Strict TDD: on (`openspec/config.yaml`, `strict_tdd: true`); runner `bun test` with focused Bun test paths first, then relevant broader tests. Record observed RED before behavior and GREEN after, plus scoped lint/typecheck and runtime boundary evidence or a reason it is unavailable.
- Task route: delegated writer when editing two or more nontrivial files; independent read-only verification as needed, native RDD at work-unit commit/PR slice boundary per session policy. Parent tracks progress and commits on this feature branch with Conventional Commit messages.
- Forecast: substantially above 400 authored added+deleted lines across contracts, app, SQL, and tests. Delivery strategy `ask-on-risk`; user selected `feature-branch-chain` for future review slices. No PR authorized.
- Each task records commit SHA, command outcomes, rollback boundary, and any pending remote validation before closing. A local-complete task never implies remote deployment is complete.

## Tasks
- [ ] **N1 — Contract and inventory.** Confirm exact reachable producer/caller matrix and cleanup dependencies; update canonical OpenSpec to define event identity, recipients, presentation, navigation, digest, inbox semantics, and compatibility. Check: contracts agree with route map and verified producer inventory; focused static tests if applicable. Route: delegated writer (multi-file contracts), read-only mapping completed.
- [ ] **N2 — Inbox correctness.** Fix stable tuple pagination and matching spec, badge/read/dismiss semantics, global mark-all affordance, and accessible actions with RED→GREEN behavior tests. Check: focused tests, frontend typecheck/lint as relevant; rollback isolated to inbox. Route: delegated writer (multi-file).
- [ ] **N3 — Actionable presentation.** Build event-aware visual inbox and one deduplicated launch digest; remove unused notification pub/sub and route-based urgency and update tests/contracts. Check: focused watcher/navigation/UI tests, frontend typecheck, app runtime check if available; rollback isolated to presentation. Route: delegated writer (multi-file).
- [ ] **N4 — Server authority and schema.** Prepare additive/restrictive SQL migration for typed source events, uniqueness/idempotency, owner-only read/read-state mutation RLS/grants, and legacy coexistence; update canonical SQL where maintained. Check: focused SQL/contract tests or local DB harness, privilege/rollback review. Do not assume generated types reflect uninstalled schema. Route: delegated writer (multi-file).
- [ ] **N5 — Producer cutover and cleanup.** Move confirmed order, cancellation, dispute, moderation, and return event creation to trusted idempotent transaction boundaries; adapt Edge-only producers with durable error handling; retire proven-dead notification surfaces and preserve older-client compatibility. Check: producer-specific RED→GREEN tests and scoped lint/typecheck; record remote Edge deployment set. Route: delegated writer, split into reviewable business-domain work units if necessary.
- [ ] **N6 — Deployment handoff and remote verification.** Enumerate exact SQL files/order, grants/RLS, Edge deployments and optional configuration, rollback, manual post-deploy checks. Wait for maintainer confirmation of applied SQL before `bun db:types`; confirm new generated types, run focused and broader applicable checks, record any blocked checks honestly. Route: delegated verification for command-running checks, parent owns release handoff.

## Progress
- 2026-09-23: Read-only exploration completed on contracts, DB/RLS snapshot, SQL/Edge producers, app, Realtime, UX, tests, and Expo push feasibility. User approved event scope including moderation outcomes, deferred push to another session, selected one actionable launch digest, and requested cleanup of proven-obsolete notification artifacts. No source changes or commits yet.
- 2026-09-23: N1 delegated to `gentle-ai-worker` for contract-only work; user selected `feature-branch-chain` for future review slices, without authorizing PR creation. Remote deployed SQL/policies/cron state remains unverified.
- Next: review N1 diff, run spot check, record commit identity only after checks pass.
