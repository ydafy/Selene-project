# Engineering tooling (BL16 follow-up)

Close the pstack-derived items deferred in BL16 (`odd/tasks/cross-module-backlog.md`) plus the DESIGN.md known gaps, one PR per item, in worktree `engineering-tooling`.
`benchmark-checklist`, hillclimb, and `correct` stay out of scope (Log L4).

## Specs

- S1. `getOrderStatusColor` returns each state's own color for `cancelled`, `refunded`, and `dispute` (DESIGN.md: "shows `cancelled`, `refunded`, and `dispute` in `error` red instead of their state colors from the table above").
- S2. In the app status badges, those three states show their state color on the border, side bar, and dot, and the label text in `textPrimary` so it stays legible (L5: "Color de estado en el borde, la barra y el punto; texto legible").
- S3. App components use no `rgba(...)` literals outside the theme; `noHardcodedColors.test.ts` fails on them as it does on hex (DESIGN.md: "App components still use `rgba(...)` literals for overlays and translucent borders; the hardcoded-color test only covers hex.").
- S4. Admin `warning` / `errorSubtle` stay unadded until an admin screen needs one (DESIGN.md: "add them to `index.css` when an admin screen needs one").
- S5. A project skill `verify-selene` gives the procedure to drive real flows on the local stack (Bruno for functions and RPCs, Playwright for admin-web, Stripe CLI for webhooks) with evidence and cleanup, without copying the `AGENTS.md` verification table; proven by running it on one real flow.
- S6. A TLA+ model of the payout invariant: a shipment is released for its full amount or not at all, and never after a cancellation refund; scope limited to shipment transfer vs shipment cancellation (L9); checked with TLC (Java + TLC install authorized, L6).
- S7. A project skill adapting pstack `technical-writing` + `unslop` for `docs/` and `odd/tasks`, without PR-body rules.

## Tasks

- T1 | S1-S2 | inline | branch `fix/design-token-gaps-2` | commit: 4284ecf (done)
- T2 | S3 | inline | branch `fix/design-token-gaps-2` | commit: 35db2b8 (done)
- T3 | S5 | worker | branch `docs/verify-selene-skill` | commit: aee2358 (done)
- T4 | S6 | worker | branch `docs/payout-invariant-tla` | commit: 5a6d49e (done)
- T5 | S7 | inline | branch `docs/technical-writing-skill` | commit: this commit (done)

## Log

- L1 (user): "okeyen un proipio woktree trataremos de cubiri todo eso que comentaste, obvio cada uno en su proio pr."
- L2 (user): "no migres nada, ya etsamos trabajdno en diferentes esiones lo que etsa anotado ahi" (cross-module-backlog stays untouched).
- L3 (user): "okey no dejala asi, esta bien que quede anotada pero no la meteremos en nuestro siguiente trabajo." (benchmark-checklist).
- L4 (user): "me sirve el plan, y si insala java y tlc." Plan: PR1 DESIGN gaps, PR2 verify-selene, PR3 TLA+, PR4 technical-writing; benchmark/hillclimb/correct out.
- L5 (user decision): contrast of `#6A3939`/`#6A4D39`/`#782B2B` text on 60% black is about 2:1; chose "1. Color de estado en el borde, la barra y el punto; texto legible".
- L6 (user): Java and TLC install authorized for T4.
- L7 (evidence): T1-T2 on `fix/design-token-gaps-2` (4284ecf, 35db2b8); bun test 3336 pass; no new typecheck or lint diagnostics; review assess medium, reviewDue false.
- L8 (T3 grounding): pstack `create-verification-skill` adapted. Skill at `.agents/skills/verify-selene/` with `features/` map; evidence in gitignored `/verification-evidence/` (Playwright wipes `test-results/` per run). Local stack only; never remote.
- L9 (user decision): T4 models only shipment transfer vs shipment cancellation ("Solo la parte protegida"); dispute actions stay out of this model for now.
- L10 (evidence): JDK Temurin 21.0.12.1 (winget) and TLC 1.8.0 at `C:/Users/estra/.local/tla/tla2tools.jar` (sha256 d15655ee...726f) installed and runnable.
- L11 (evidence T3): proof run on local stack: doctor checks pass; `bun run test:e2e:local` 1/1 (refund problems) with trace; `bun run api:test` 116/116; evidence kept in `verification-evidence/admin-refund-problems/20261025-2014/` after `supabase stop`. Unverified: `stripe:listen` + `stripe trigger` (no sandbox login in the run), Stripe MCP cross-check.
- L12 (evidence T4): `docs/formal/shipment-transfer-cancellation/` (model, cfg, README). TLC (jar sha256 d15655ee...726f, prints `2026.10.24.013619`): no error, 3,295,096 states, 995,560 distinct, depth 29 (re-run by parent). Eight broken variants each violate their property (table in README).
- L13 (evidence T5): `.agents/skills/selene-technical-writing/` (SKILL.md, references/unslop.md, LICENSE). PR-body and commit rules dropped; verbatim `## Specs`/`## Log` quotes protected. Listed as ours in `AGENTS.md` and `docs/skills.md`. prettier clean; bun test 3342 pass.
