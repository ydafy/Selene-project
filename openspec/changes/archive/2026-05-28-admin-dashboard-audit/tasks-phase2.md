# Phase 2 — Type Safety & TanStack Table Migration: Task Breakdown

## 1. Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~784 total (PR 1: ~296, PR 2: ~488) |
| 400-line budget risk | **Yes** — PR 2 exceeds budget (488 > 400). Mitigated by 2-PR split. |
| Chained PRs recommended | **Yes** — already planned spec-design split |
| Delivery strategy | **Chained PRs → main** (2 sequential PRs) |

### PR-level forecast

| PR | Estimated Lines | Net Δ | Risk | Mitigation |
|----|----------------|-------|------|------------|
| **PR 1 — Foundation** | ~296 | ~+280 (DataTable.tsx is ~200 new, rest is additive types) | Low — new file + additive types, no behavioral changes | 296 < 400, safe for single review |
| **PR 2 — Table Migration** | ~488 | ~−50 (replace verbose HTML tables with DataTable calls, but add CARD_LIST_DECISION.md) | Medium — high surface area (9 non-table files + 5 table files), visual parity risk | One table per commit; per-file revert table available. 488 > 400, accepted as exception because all changes are mechanical (type replacements + DataTable usage) with no new logic. |

### eslint-disable inventory (14 occurrences across 14 files — current state)

```
PR 1 files:          (none have eslint-disable — hooks use raw `any` without disabling eslint)
PR 2 — table files:  InventoryTable.tsx, PurchasesTable.tsx, UserTransactionsTable.tsx, UserPayoutsTable.tsx, DisputesTable.tsx
PR 2 — page files:   UsersPage.tsx, DisputesPage.tsx
PR 2 — card-list:    UserCard.tsx, UserBankCard.tsx, UserReviewsList.tsx, UserReportsList.tsx,
                     UserDisputesList.tsx, UserAddressesList.tsx, UserAdminHistory.tsx
PR 2 — misc:         UserSafetyActions.tsx
```

**Split rationale**: PR 1 touches zero files with eslint-disable (hooks use inline `any` without disabling the rule). All 14 eslint-disable comments are in files restructured in PR 2 — fixing types alongside the migration is more efficient than fixing types in PR 1 and restructuring in PR 2.

---

## 2. PR 1 — Foundation Tasks

### T-201 — Regenerate Supabase Database Types

| Field | Value |
|-------|-------|
| **Description** | Run `bun db:types` to regenerate `packages/types/src/database.types.ts` from the linked Supabase project. Audit the diff for breaking changes (removed/renamed columns, deleted tables/enums). Fix `packages/types/src/index.ts` aliases if any existing `Tables<'x'>` references break. Do NOT add aliases for new tables unless this phase needs them. |
| **Requirements** | PH2-REQ-001 |
| **Files** | Modify: `packages/types/src/database.types.ts` (regenerated in full) |
| **Dependencies** | None |
| **Verification** | `bun db:types` exits 0. `git diff packages/types/src/database.types.ts` shows no breaking changes (or expected additive changes only). `bunx tsc --noEmit` in `packages/types` exits 0. |
| **Effort** | XS (~0 lines intentionally changed — file is regenerated) |

---

### T-202 — Create Enriched Type Interfaces

| Field | Value |
|-------|-------|
| **Description** | Add 5 enriched type interfaces to `packages/types/src/index.ts` alongside existing `EnrichedProduct`, `ProductWithSeller`, `EnrichedOrder`. These represent database view shapes and joined query results, NOT raw table rows. Interfaces to add: `PendingProduct`, `AdminUser`, `DisputeSummary`, `OrderItemWithProduct`, `AdminAuditLog`. See design doc for exact field definitions. All use `Tables<'...'>` as base types where applicable. No `any` types. |
| **Requirements** | PH2-REQ-002 |
| **Files** | Modify: `packages/types/src/index.ts` (~80 lines added after line 127, before the `export * from './database.types'`) |
| **Dependencies** | T-201 (types must be current before defining enriched types) |
| **Verification** | `grep 'interface PendingProduct' packages/types/src/index.ts` returns non-empty. Same for `AdminUser`, `DisputeSummary`, `OrderItemWithProduct`, `AdminAuditLog`. `bunx tsc --noEmit` in `packages/types` exits 0. `bunx tsc -b` in `apps/admin-web` exits 0. |
| **Effort** | M (~80 lines, 5 interfaces, moderate complexity — must match DB view shapes exactly) |

---

### T-203 — Build Generic DataTable Component

| Field | Value |
|-------|-------|
| **Description** | Create `apps/admin-web/src/components/ui/DataTable.tsx` — a reusable generic `<DataTable<TData>>` component wrapping `@tanstack/react-table` v8. Full dark theme styling matching project patterns. Supports: generic `TData` type parameter flowing through `ColumnDef<TData>`, client-side sorting (default) or controlled server-side sorting, client-side pagination (default, page size 10) or controlled server-side pagination, loading skeleton rows, empty state, optional header slot, optional `onRowClick`. See spec scenarios S-001 through S-013 for detailed behavior. Column definitions must be `useMemo`'d or module-level constants per react-best-practices `rerender-memo`. |
| **Requirements** | PH2-REQ-003 |
| **Files** | **Create**: `apps/admin-web/src/components/ui/DataTable.tsx` (~200 lines new file) |
| **Dependencies** | T-202 (enriched types may be used as `TData` in some column defs — not blocking, but the types should exist) |
| **Verification** | File exists at expected path. `bunx tsc -b` in `apps/admin-web` exits 0. Component handles: loading state (skeleton rows), empty state (centered message), full data (rows render), sort click (toggles direction), pagination (Previous/Next with page info), header slot, `onRowClick`, resilient to `undefined`/`null` data. All 13 scenarios (S-001 through S-013) pass. |
| **Effort** | L (~200 lines new, TanStack hook integration, 3 state branches, accessibility) |

---

### T-204 — Fix Hook `catch (err: any)` → `(err: unknown)`

| Field | Value |
|-------|-------|
| **Description** | Replace 4 `catch (err: any)` clauses across 2 hook files with `catch (err: unknown)` + `err instanceof Error` type guard. Files: `useProductLock.ts` (2 catches: acquireLock line 62, releaseLock line 86) and `useDisputeActions.ts` (2 catches: acquireLock line 39, releaseLock line 58). The releaseLock catches intentionally do nothing with the error — use `catch { }` (empty catch, no variable) or `catch (_err: unknown) { }` with underscore prefix. For acquireLock catches, extract message: `err instanceof Error ? err.message : 'Unknown error'`. Also fix `useDisputeActions.ts` line 100's `onError: (error: any)` → `onError: (error: Error)` (TanStack Query's mutation onError always passes Error). |
| **Requirements** | PH2-REQ-004 |
| **Files** | Modify: `apps/admin-web/src/hooks/useProductLock.ts` (~6 lines changed), `apps/admin-web/src/hooks/useDisputeActions.ts` (~8 lines changed) |
| **Dependencies** | None |
| **Verification** | `grep -n 'catch.*any' apps/admin-web/src/hooks/useProductLock.ts apps/admin-web/src/hooks/useDisputeActions.ts` returns zero matches. `grep -n 'onError.*any' apps/admin-web/src/hooks/useDisputeActions.ts` returns zero matches. Tests S-200, S-201 pass. `bunx tsc -b` passes. Hook behavior unchanged — acquire/release/resolve still works, toast notifications still fire. |
| **Effort** | S (~14 lines changed across 2 files, mechanical replacements) |

---

### T-205 — Fix UI Component Types + StatusBadge Narrow

| Field | Value |
|-------|-------|
| **Description** | In `StatusBadge.tsx`, narrow `status: StatusType \| string` → `status: StatusType`. The `StatusType` union already covers all known status values (order, product, dispute, payout, account). The `config[status] \|\| '...'` fallback in the component body handles any unexpected runtime values gracefully. Verify all 4 other UI components (`StatCard.tsx`, `UserAvatar.tsx`, `SecureImage.tsx`, `ErrorState.tsx`) have zero eslint-disable comments and no `any` types. |
| **Requirements** | PH2-REQ-005 |
| **Files** | Modify: `apps/admin-web/src/components/ui/StatusBadge.tsx` (~1 line changed) |
| **Dependencies** | None |
| **Verification** | `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/components/ui/` returns zero matches. `bunx tsc -b` passes. Status badges for all known status values render identically (no visual regression). |
| **Effort** | XS (~1 line changed, plus verification of 4 other files) |

---

### T-206 — eslint-disable Audit for Non-Table Files (PR 1 Coverage)

| Field | Value |
|-------|-------|
| **Description** | Audit all non-table files in `apps/admin-web/src/` for `eslint-disable @typescript-eslint/no-explicit-any`. In **PR 1**, this is a scoped cleanup: no file touched in PR 1 currently has an eslint-disable comment, so the task is to **verify that no new eslint-disable comments were introduced** by T-201 through T-205. The actual eslint-disable removals from page files (`UsersPage.tsx`, `DisputesPage.tsx`), card-list files (`UserCard.tsx`, `UserBankCard.tsx`, `UserReviewsList.tsx`, `UserReportsList.tsx`, `UserDisputesList.tsx`, `UserAddressesList.tsx`, `UserAdminHistory.tsx`), and `UserSafetyActions.tsx` are **deferred to PR 2** (where those files also get structural type fixes). This split is documented in the design because those files need both type fixes AND eslint-disable removal — doing them together is more efficient. |
| **Requirements** | PH2-REQ-006 (partial — PR 1 coverage) |
| **Files** | None to modify in PR 1. Verification only. |
| **Dependencies** | T-204, T-205 (verify those tasks didn't introduce eslint-disable) |
| **Verification** | `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/ --include='*.tsx' --include='*.ts'` returns the same 14 matches as before PR 1 (no new ones added). The remaining 14 are cleaned in PR 2 (T-207 through T-215). |
| **Effort** | XS (verification only — no code changes in PR 1) |

---

## 3. PR 2 — Table Migration Tasks

### T-207 — Migrate InventoryTable to DataTable

| Field | Value |
|-------|-------|
| **Description** | Rewrite `InventoryTable.tsx` from hand-rolled HTML `<table>` to `<DataTable<Product>>`. Define 4 columns: "Producto" (image thumbnail + name with `flex items-center gap-3`), "Precio" (formatted currency `$X,XXX`), "Estatus" (`StatusBadge`), "Fecha" (locale date). Header slot: "Inventario Reciente" with `items.length` count. Empty state: "Este usuario no tiene productos registrados." Remove file-level `/* eslint-disable @typescript-eslint/no-explicit-any */`. Columns defined as module-level constant or `useMemo`. |
| **Requirements** | PH2-REQ-007 |
| **Files** | Modify: `apps/admin-web/src/components/features/users/InventoryTable.tsx` (~40 lines changed) |
| **Dependencies** | PR 1 (DataTable component T-203, enriched types T-202) |
| **Verification** | `grep -c 'DataTable' apps/admin-web/src/components/features/users/InventoryTable.tsx` >= 1. No HTML `<table>` element remains. `bunx tsc -b` passes. Visual parity: same column count, header labels, cell content, styling as before. |
| **Effort** | M (~40 lines, straightforward 4-column migration) |

---

### T-208 — Migrate PurchasesTable to DataTable

| Field | Value |
|-------|-------|
| **Description** | Rewrite `PurchasesTable.tsx` from hand-rolled HTML `<table>` to `<DataTable<OrderItemWithProduct>>`. Define 4 columns: "Producto" (image + name), "Precio Pagado" (formatted currency), "Estado Orden" (`StatusBadge` from `row.original.orders?.status`), "Fecha" (formatted date). Header slot: "Compras Recientes" with count. Empty state: match current behavior (returns empty fragment when items array is empty — use `if (items.length === 0) return null` before rendering DataTable). Remove file-level eslint-disable. |
| **Requirements** | PH2-REQ-008 |
| **Files** | Modify: `apps/admin-web/src/components/features/users/PurchasesTable.tsx` (~40 lines changed) |
| **Dependencies** | PR 1 (DataTable T-203, enriched types T-202) |
| **Verification** | `grep -c 'DataTable' PurchasesTable.tsx` >= 1. No HTML `<table>` remains. Empty data renders nothing (returns null). `bunx tsc -b` passes. Visual parity confirmed. |
| **Effort** | M (~40 lines, similar to InventoryTable) |

---

### T-209 — Migrate UserTransactionsTable to DataTable

| Field | Value |
|-------|-------|
| **Description** | Rewrite `UserTransactionsTable.tsx` to `<DataTable<WalletTransaction>>` — the most complex table with 7 columns and conditional coloring. Columns: "Fecha" (locale date+time, left-aligned), "Tipo / Descripción" (icon + label + description — preserve icon mapping via `getTypeLabel` switch on `row.original.type`), "Monto Bruto" (right-aligned, formatted), "Comisión Selene" (right-aligned, show `-$fee` in `text-fire` if > 0, else `—`), "Costo Envío" (right-aligned, same conditional), "Neto" (right-aligned, bold: positive=`text-forest` with `+` prefix, negative=`text-fire`, zero=`text-platinum`), "Saldo Final" (right-aligned, `text-lion` font-mono, `bg-white/[0.02]`). Header slot: "Historial de Movimientos (Ledger)". Empty state: icon + "No se han registrado movimientos financieros aún." Remove file-level eslint-disable. Verify `getTypeLabel` keys match the `wallet_transactions.type` enum from database.types.ts. |
| **Requirements** | PH2-REQ-009 |
| **Files** | Modify: `apps/admin-web/src/components/features/users/UserTransactionsTable.tsx` (~80 lines changed) |
| **Dependencies** | PR 1 (DataTable T-203, enriched types T-202) |
| **Verification** | `grep -c 'DataTable' UserTransactionsTable.tsx` >= 1. No HTML `<table>` remains. S-101 passes: positive net values have `+` prefix + `text-forest`, negative = `text-fire`, zero = `text-platinum`. All 7 columns render with correct alignment, formatting, and conditional styling. `bunx tsc -b` passes. |
| **Effort** | L (~80 lines, 7 columns with conditional formatting, icon mapping, color logic) |

---

### T-210 — Migrate UserPayoutsTable to DataTable

| Field | Value |
|-------|-------|
| **Description** | Rewrite `UserPayoutsTable.tsx` to `<DataTable<PayoutRequest>>`. Define 3 columns: "Monto" (bold, formatted currency), "Estatus" (`StatusBadge`), "Fecha" (formatted request date or "N/A"). Header slot: "Historial de Retiros". Empty state: "No hay retiros registrados." **Scroll behavior**: preserve `max-h-[300px]` on the DataTable wrapper (apply to the outer container, not the table itself — the table header should remain visible while body scrolls). Remove file-level eslint-disable. |
| **Requirements** | PH2-REQ-010 |
| **Files** | Modify: `apps/admin-web/src/components/features/users/UserPayoutsTable.tsx` (~30 lines changed) |
| **Dependencies** | PR 1 (DataTable T-203, enriched types T-202) |
| **Verification** | `grep -c 'DataTable' UserPayoutsTable.tsx` >= 1. S-103 passes: scroll container has `max-h-[300px]`, header visible, body scrolls. `bunx tsc -b` passes. |
| **Effort** | S (~30 lines, simple 3-column migration with scroll wrapper) |

---

### T-211 — Migrate DisputesTable to DataTable

| Field | Value |
|-------|-------|
| **Description** | Rewrite `DisputesTable.tsx` to `<DataTable<DisputeSummary>>` — replaces both HTML table and spinner loading state. Define 6 columns: "Reporte" (calendar icon + formatted `dispute_date`), "Orden / Monto" (truncated `order_id` + `total_amount`), "Involucrados" (`buyer_username` + `seller_username`), "Motivo" (`dispute_reason_preview` with underscore-to-space replacement), "Estatus" (`StatusBadge` from `dispute_status`), "Acción" (right-aligned `<button><ChevronRight /></button>` calling `onViewDetails`). Row click (`onRowClick`) also calls `onViewDetails`. Loading: `isLoading` prop drives DataTable skeletons. Empty state: Gavel icon + "Bandeja de entrada vacía. No hay casos pendientes." Remove file-level eslint-disable. |
| **Requirements** | PH2-REQ-011 |
| **Files** | Modify: `apps/admin-web/src/components/features/disputes/DisputesTable.tsx` (~120 lines changed) |
| **Dependencies** | PR 1 (DataTable T-203, enriched types T-202 — specifically `DisputeSummary`) |
| **Verification** | `grep -c 'DataTable' DisputesTable.tsx` >= 1. S-102 passes: action button + row click both call `onViewDetails` with correct dispute ID. Loading state shows skeleton rows (no spinner overlay). Empty state shows icon + message. `bunx tsc -b` passes. |
| **Effort** | L (~120 lines, 6 columns + action button + row click + skeleton loading transition) |

---

### T-212 — Clean UsersPage Data Access Types

| Field | Value |
|-------|-------|
| **Description** | **Decision**: Keep the card grid (Option A per spec PH2-REQ-012). Do NOT migrate to DataTable. Replace `user: any` in the card map callback with `user: AdminUser`. Remove the file-level `/* eslint-disable @typescript-eslint/no-explicit-any */`. The card grid provides rich visual context (avatar, rank badge, email copy, balance) that a table would lose. Pagination controls remain unchanged (server-side via `useUsers(search, page, statusFilter, sortBy)`). |
| **Requirements** | PH2-REQ-012 |
| **Files** | Modify: `apps/admin-web/src/pages/UsersPage.tsx` (~4 lines changed: remove eslint-disable line 1, change `user: any` to `user: AdminUser` in the `.map()` callback) |
| **Dependencies** | PR 1 (T-202 for `AdminUser` interface), T-207–T-211 (no dependency — can run in parallel) |
| **Verification** | `grep -c 'eslint-disable.*no-explicit-any' apps/admin-web/src/pages/UsersPage.tsx` returns 0. `grep 'AdminUser' apps/admin-web/src/pages/UsersPage.tsx` returns non-zero. `bunx tsc -b` passes. Cards render identically with same avatar, stats, click behavior. |
| **Effort** | XS (~4 lines changed, trivial type replacement) |

---

### T-213 — Clean VerificationPage Data Access Types

| Field | Value |
|-------|-------|
| **Description** | **Decision**: Keep the card list (Option A per spec PH2-REQ-013). The product cards have rich layout semantics (image, category badge, price, seller info, time-in-queue) that a table can't match without excessive nesting. Replace all `any` types: product variables → `PendingProduct`, internal notes → `PendingProduct['internal_notes'][0]`, `resolve.mutate` params → properly typed. **No eslint-disable to remove** (the file currently has none — verify it stays that way). |
| **Requirements** | PH2-REQ-013 |
| **Files** | Modify: `apps/admin-web/src/pages/VerificationPage.tsx` (~10 lines changed: `(p: any)` → `(p: PendingProduct)`, `(product: any)` → `(product: PendingProduct)`, `(note: any)` → typed with `PendingProduct['internal_notes'][number]`, type the `resolve.mutate` call arguments) |
| **Dependencies** | PR 1 (T-202 for `PendingProduct` interface) |
| **Verification** | `grep -c 'eslint-disable.*no-explicit-any' apps/admin-web/src/pages/VerificationPage.tsx` returns 0. `grep -n 'any' apps/admin-web/src/pages/VerificationPage.tsx` shows no `any` used as a type annotation (tolerating `any` as part of variable names or strings). `bunx tsc -b` passes. Card list renders identically with same image, price, badge, seller info. |
| **Effort** | S (~10 lines changed across 4-5 spots, mechanical type replacements) |

---

### T-214 — Clean DisputesPage Data Access Types

| Field | Value |
|-------|-------|
| **Description** | Remove the file-level `/* eslint-disable @typescript-eslint/no-explicit-any */`. Replace the `filter as any` cast (line 44 in `setFilter(id as any)`) with a properly typed union: `setFilter(id as 'open' | 'resolved' | 'all')` or a typed helper function. The `DisputesTable` component itself is migrated in T-211 — this task only fixes DisputesPage's own type issues. |
| **Requirements** | PH2-REQ-014 |
| **Files** | Modify: `apps/admin-web/src/pages/DisputesPage.tsx` (~2 lines changed: remove eslint-disable line 1, fix `as any` cast) |
| **Dependencies** | T-211 (DisputesTable migration — no strict dependency, but both touch disputes-related files) |
| **Verification** | `grep -c 'eslint-disable.*no-explicit-any' apps/admin-web/src/pages/DisputesPage.tsx` returns 0. `grep 'as any' apps/admin-web/src/pages/DisputesPage.tsx` returns 0. `bunx tsc -b` passes. Filter behavior unchanged. |
| **Effort** | XS (~2 lines changed, trivial) |

---

### T-215 — Document Card-List Decisions + Fix Card-List Types + Remove eslint-disable

| Field | Value |
|-------|-------|
| **Description** | Three-part task combining PH2-REQ-015 (documentation) with PH2-REQ-006 remainder (type fixes + eslint-disable removal from card-list files):<br><br>**Part A — Decision Documentation**: Create `CARD_LIST_DECISION.md` documenting why each of the 5 card-list components stays as cards (per design Decision 3): `UserReviewsList` (rich star rating + comment layout), `UserReportsList` (feed-item structure), `UserDisputesList` (per-user outcome coloring), `UserAddressesList` (structured document layout), `UserAdminHistory` (activity feed/timeline).<br><br>**Part B — Type Fixes**: Replace `any` types in each card-list file with proper interfaces:<br>- `UserReviewsList.tsx`: `rev: any` → typed `Review` interface (fields: `id`, `rating`, `comment`, `created_at`, `reviewer: { username: string; avatar_url: string \| null }`)<br>- `UserReportsList.tsx`: `reports: any[]` → typed `Report` interface (fields: `id`, `reason`, `status`, `created_at`, `reporter: { username: string }`)<br>- `UserDisputesList.tsx`: `disputes: any[]` → typed inline interface matching used fields<br>- `UserAddressesList.tsx`: `addresses: any[]` → `Tables<'addresses'>[]`<br>- `UserAdminHistory.tsx`: `logs: any[]` → `AdminAuditLog[]`, `notes: any[]` → typed inline interface<br><br>**Part C — eslint-disable Removal**: Remove file-level or inline eslint-disable from all 5 card-list files + `UserCard.tsx`, `UserBankCard.tsx`, `UserSafetyActions.tsx`. |
| **Requirements** | PH2-REQ-015 (decision doc) + PH2-REQ-006 (remainder — card-list type fixes + eslint-disable removal) |
| **Files** | **Create**: `apps/admin-web/src/components/features/users/CARD_LIST_DECISION.md` (~30 lines)<br>**Modify**: <br>- `UserReviewsList.tsx` (~5 lines: replace `rev: any`, remove eslint-disable)<br>- `UserReportsList.tsx` (~5 lines: replace `reports: any[]`, remove eslint-disable)<br>- `UserDisputesList.tsx` (~5 lines: replace `disputes: any[]`, remove eslint-disable)<br>- `UserAddressesList.tsx` (~3 lines: replace `addresses: any[]` → `Tables<'addresses'>[]`, remove eslint-disable)<br>- `UserAdminHistory.tsx` (~8 lines: replace `logs: any[]`, `notes: any[]`, remove eslint-disable)<br>- `UserCard.tsx` (~2 lines: replace inline eslint-disable + `user: any` → `user: AdminUser`)<br>- `UserBankCard.tsx` (~2 lines: replace inline eslint-disable + `bank: any` → `bank: SellerBankAccount`)<br>- `UserSafetyActions.tsx` (~2 lines: replace inline eslint-disable + `user: any` → typed `{ id: string; status: AccountStatus; is_verified_seller: boolean }`) |
| **Dependencies** | PR 1 (T-202 for `AdminUser`, `AdminAuditLog` interfaces and for `Tables<'addresses'>`) |
| **Verification** | File `CARD_LIST_DECISION.md` exists with decisions for all 5 components. `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/ --include='*.tsx' --include='*.ts'` returns **zero matches across ALL files** (this is the final cleanup). `bunx tsc -b` passes. `bun run build` in `apps/admin-web` exits 0. |
| **Effort** | M (~55 lines total across 9 files: ~30 lines for decision doc + ~25 lines for type fixes across 8 components) |

---

## 4. Execution Order

### Dependency Graph

```
PR 1:
  T-201 (Regenerate DB types)
    ↓
  T-202 (Enriched type interfaces)
    ↓
  T-203 (DataTable component) ──────────────────────────────┐
                                                             │
  T-204 (Hook fixes) ────┐                                   │
                         ├── (all independent of T-203)      │
  T-205 (UI components) ─┘                                   │
                                                             │
  T-206 (eslint audit) ←─ verifies output of T-204, T-205   │
                                                             │
                                              All feed into ─┘
                                                             ↓
PR 2:                                Depends on T-203 (DataTable exists)
                                     Depends on T-202 (enriched types exist)

  T-207 (InventoryTable)         ─┐
  T-208 (PurchasesTable)          ├── (all independent of each other)
  T-209 (UserTransactionsTable)   │
  T-210 (UserPayoutsTable)        │
  T-211 (DisputesTable)           │
  T-212 (UsersPage types)         │
  T-213 (VerificationPage types)  │
  T-214 (DisputesPage types)      │
  T-215 (Card-list docs + types) ─┘
```

### Intra-PR grouping

**PR 1 — Suggested work-unit commits:**

| Commit | Scope | Tasks |
|--------|-------|-------|
| 1 | `chore(types): regenerate supabase db types` | T-201 |
| 2 | `feat(types): add enriched interfaces for admin views` | T-202 |
| 3 | `feat(admin): create generic DataTable component` | T-203 |
| 4 | `refactor(admin): replace catch (err: any) with unknown in hooks` | T-204 |
| 5 | `refactor(admin): narrow StatusBadge type, audit ui components` | T-205 + T-206 |

**PR 2 — Suggested work-unit commits:**

| Commit | Scope | Tasks |
|--------|-------|-------|
| 1 | `refactor(admin): migrate InventoryTable to DataTable` | T-207 |
| 2 | `refactor(admin): migrate PurchasesTable to DataTable` | T-208 |
| 3 | `refactor(admin): migrate UserTransactionsTable to DataTable` | T-209 |
| 4 | `refactor(admin): migrate UserPayoutsTable to DataTable` | T-210 |
| 5 | `refactor(admin): migrate DisputesTable to DataTable` | T-211 |
| 6 | `refactor(admin): clean UsersPage, VerificationPage, DisputesPage types` | T-212, T-213, T-214 |
| 7 | `docs(admin): document card-list migration decisions and fix types` | T-215 |

Each commit is independently revertable. Table migrations are isolated — if one has issues, only that file needs reverting.

---

## 5. Delivery Recommendation

| Item | Recommendation | Rationale |
|------|---------------|-----------|
| **PR 1 delivery** | Single PR → main (~296 lines, under 400 budget) | Low risk, additive changes only (new DataTable file + types + mechanical hook fixes). No behavioral changes. |
| **PR 1 commits** | 5 logical commits (see above) | Each commit is a focused work unit with verification. T-204 + T-205 + T-206 can be one commit since they're all mechanical cleanup. |
| **PR 2 delivery** | Chained PR stacked after PR 1 (~488 lines, over budget but accepted exception) | 488 > 400, but all changes are mechanical (type replacements + DataTable wrapper calls). No new logic. Visual parity risk mitigated by one-table-per-commit approach. |
| **PR 2 commits** | 7 commits (one per table migration + one for pages + one for card-list cleanup) | Each table migration is independently revertable. Reviewer can verify one table at a time. |
| **Risk acceptance** | PR 2 size exception is accepted | All PR 2 changes are structural (replace HTML table with DataTable component) or type-only. No new business logic, no new queries, no data flow changes. The 88-line overage is almost entirely from boilerplate column definitions. |
| **Rollback per table** | `git checkout HEAD~1 -- path/to/Table.tsx` | Restores the hand-rolled HTML table. DataTable component (PR 1) stays. |

### Verification sequence (recommended order)

After each PR is applied to the dev branch:

1. `bun db:types` → exit 0
2. `bunx tsc -b` → exit 0 (in both `packages/types` and `apps/admin-web`)
3. `bun run build` → exit 0 (in `apps/admin-web`)
4. `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/` → zero matches (after PR 2)
5. Visual spot-check for each migrated table (dev server → navigate → verify rendering)
6. Sort click, pagination click, empty state, loading state per table
