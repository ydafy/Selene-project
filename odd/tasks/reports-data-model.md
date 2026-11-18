# Reports data model

Roadmap #644 item 11, issue #653. Branch `feat/reports-data-model` from `origin/main` 0269a8c9, worktree reports-model.
Gives `public.reports` a model the admin workflow (#298) and the store-required report flow (#682) build on. Does not touch the money core (items 2-8).

## Specs

- S1. "Every report points at an existing target and records how it was resolved." (#653) A report has exactly one target: `target_product_id` (FK to `products`) or `target_user_id` (FK to `profiles`), both `ON DELETE RESTRICT` (L2). `target_id` and `target_type` are dropped. The two remote test rows are deleted, no backfill.
- S2. The reason is required: enum `report_reason` with `fraud`, `counterfeit_or_misdescribed`, `prohibited_item`, `offensive_content`, `harassment`, `spam`, `other`, plus optional `details` text of at most 1000 characters (L2).
- S3. "a status type, resolution fields" (#653): enum `report_status` (`open`, `resolved`, default `open`); `resolved_by` (FK to `profiles`), `resolved_at`, `outcome` (enum `report_outcome`: `dismissed`, `warned`, `listing_removed`, `account_suspended`) and `resolution_note`. A CHECK requires `resolved_by`, `resolved_at` and `outcome` exactly when the status is `resolved`. No reopening.
- S4. "one open report per reporter and target" (#653): partial unique indexes on `(reporter_id, target_product_id)` and `(reporter_id, target_user_id)` where the status is `open`. A user cannot report themselves or their own listing.
- S5. Clients insert only: `authenticated` gets INSERT on `reporter_id`, `target_product_id`, `target_user_id`, `reason` and `details`, with `reporter_id = auth.uid()`. Only admins read reports (SELECT policy on `is_admin()`, L3); users read none, not even their own. `reporter_id` and `resolved_by` are `ON DELETE RESTRICT` too (L3).
- S6. "the app's report action" (#653): reporting a listing or a user asks for a reason and optional details, in English and Spanish; a second open report on the same target shows that it was already reported; the profile screen says "user", not "listing". These two report points move here from #682 (L2).
- S7. Admin-web user detail lists the reports against that user by `target_user_id` with explicit columns, showing reason, details and status.
- S8. Retention class for #450: `reports` is kept forever as moderation evidence. Indexes support the open queue (#298) and per-target lookups.

## Tasks

- [ ] T1 (S1-S5, S8) SQL: enums, table, indexes, RLS and grants, migration, pgTAP, types. Own commit.
- [ ] T2 (S6) app report action: reason picker, i18n, duplicate handling, profile label.
- [ ] T3 (S7) admin-web user detail reports.
- [ ] T4 docs and issue comments (#682, #450, #298); PR closes #653.

## Log

- L1 (2026-11-17, maintainer): "Arranquemos el roadmap #644 (modelo de datos para la meta de diseño) por uno de los ítems que no dependen del núcleo de dinero: 9 (#651), 10 (#652), 11 (#653) o 12 (#450). [...] Proponeme el cambio concreto (tablas, columnas, migraciones, qué código cambia) y esperá mi aprobación antes de escribir código."
- L2 (2026-11-17): Agent recommended #653 first: the only item with no money-core collision (#652: 19 of 22 notification text writers are money, order, shipment or dispute functions; #651: `reserved`, `sold`, `in_dispute` are written by checkout, payment and dispute functions; #450 waits for #652's notification shape and #646's event tables), and it unblocks #298 and #682 (Go-live). Remote had 2 test rows, one with the hand-written status `open` and one without a reason. Maintainer: "si a todo master, osea 1,2,3 y 4, lo hascemos asi como dices." Approved: #653 first, the reason list, `ON DELETE RESTRICT` on target FKs, and moving #682's two report points here.
- L3 (2026-11-17, agent): `reports` had no SELECT policy, so admin-web's user detail always listed zero reports (the grant existed, RLS returned nothing). Added `reports_select_admin`. `reporter_id` (was CASCADE) and `resolved_by` are RESTRICT like the targets, so the evidence outlives any profile delete; profiles are anonymised on closure, never deleted.
