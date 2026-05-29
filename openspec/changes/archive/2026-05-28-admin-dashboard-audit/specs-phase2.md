# Phase 2 — Type Safety & TanStack Table Migration

Delta spec for Phase 2 of the admin dashboard audit & refactor. Phase 2 eliminates all `any` types and `eslint-disable @typescript-eslint/no-explicit-any` across the admin-web workspace, creates a reusable generic `DataTable` component wrapping `@tanstack/react-table` v8, and migrates all hand-rolled HTML `<table>` elements to use it.

## Overview

### What Phase 2 Accomplishes

1. **Zero `any` types** in `apps/admin-web/src/` — all 14+ files with `eslint-disable @typescript-eslint/no-explicit-any` are cleaned up, replaced with proper types from `packages/types` or component-specific interfaces.
2. **Generic DataTable component** — a reusable `<DataTable<TData>>` wrapper around `@tanstack/react-table` v8 with client-side sorting, pagination, loading skeletons, empty state, optional header slot, and optional row click handler. Styled to match the existing dark theme.
3. **All HTML `<table>` elements migrated** — 5 table components (`InventoryTable`, `PurchasesTable`, `UserTransactionsTable`, `UserPayoutsTable`, `DisputesTable`) rebuilt on DataTable.
4. **Card-based list evaluation** — decision documented for `UserReviewsList`, `UserReportsList`, `UserDisputesList`, `UserAddressesList`, `UserAdminHistory` (do NOT migrate — stay as cards).
5. **Hook `any` cleanup** — `useProductLock`, `useDisputeActions` replace `catch (err: any)` with `catch (err: unknown)` and proper type guards.

### 2-PR Split

| PR | Scope | Est. Lines | Risk |
|----|-------|------------|------|
| **PR 1 — Foundation** | Type regeneration, enriched interfaces, DataTable component, hook cleanup, UI component cleanup, eslint-disable removal from non-table files | ~300 | Low |
| **PR 2 — Table Migration** | All 5 table components migrated to DataTable, UsersPage/VerificationPage/DisputesPage any cleanup, card-list decision documentation | ~500 | Medium — visual parity must be verified |

**Dependency**: PR 1 must be merged before PR 2 starts (PR 2 depends on DataTable component existing).

---

## Requirements

### PR 1 — Foundation

#### PH2-REQ-001: Regenerate Supabase Database Types

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-001 |
| **Title** | Regenerate Supabase Database Types |
| **Description** | Run `bun db:types` (which executes `supabase gen types typescript --linked > packages/types/src/database.types.ts`) to synchronize generated types with the current database schema. Audit the diff for breaking changes to existing aliases in `packages/types/src/index.ts`. |
| **Acceptance Criteria** | `bun db:types` exits with code 0. `packages/types/src/database.types.ts` is updated. `bunx tsc --noEmit` in `packages/types` passes. No existing `Tables<'...'>` aliases in `index.ts` reference deleted or renamed tables. If new tables or enums exist, corresponding aliases MAY be added but are NOT required for this phase. |

#### PH2-REQ-002: Create Enriched Type Interfaces

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-002 |
| **Title** | Create Enriched Type Interfaces for Joined/View Data |
| **Description** | Create type interfaces in `packages/types/src/index.ts` for the composite data shapes used by admin-web pages and table components. These interfaces represent the return types of RPC functions, database views, and joined queries — NOT raw table rows. |
| **Acceptance Criteria** | The following interfaces exist and are exported from `packages/types/src/index.ts` (or a sibling file like `admin.ts`):<br><br>**`PendingProduct`**: extends `Product` with `seller: Profile \| null`, `seller_stats: { verified: number; rejected: number; sold: number; ratio: number }`, `verification_data: VerificationData`, `internal_notes: Array<{ content: string; created_at: string; admin: { username: string } \| null }>`, `rejection_reason?: string \| null`.<br><br>**`AdminUser`**: fields matching the `admin_user_directory_view` database view — `id`, `username`, `email`, `role`, `status`, `avatar_url`, `available_balance`, `pending_balance`, `sold_count`, `verified_count`, `processed_count`, `created_at`.<br><br>**`DisputeSummary`**: fields matching the `admin_disputes_monitor_view` — `dispute_id`, `dispute_date`, `order_id`, `total_amount`, `buyer_username`, `seller_username`, `dispute_reason_preview`, `dispute_status`.<br><br>**`OrderItemWithProduct`**: extends `Tables<'order_items'>` with `product: Product`, `orders: Pick<Order, 'status'>`.<br><br>**`AdminAuditLog`**: fields matching the `admin_audit_logs` table with joined `admin: { username: string } \| null`.<br><br>All existing interfaces (`EnrichedProduct`, `ProductWithSeller`, `EnrichedOrder`) remain unchanged. All new types use `Tables<'...'>` as base where applicable. No `any` types in any interface. `bunx tsc --noEmit` in both `packages/types` and `apps/admin-web` passes. |

#### PH2-REQ-003: Create Generic DataTable Component

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-003 |
| **Title** | Create Generic DataTable Component |
| **Description** | Build a reusable `<DataTable<TData>>` component at `apps/admin-web/src/components/ui/DataTable.tsx` that wraps `@tanstack/react-table` v8 with consistent dark theme styling. The component must support sorting, pagination, loading state, empty state, optional header, and optional row click. |
| **Acceptance Criteria** | The component exists and exports the following API:<br><br>```typescript
interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading?: boolean;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  pagination?: PaginationState;
  onPaginationChange?: (pagination: PaginationState) => void;
  pageCount?: number;
  totalRows?: number;
  header?: React.ReactNode;
  onRowClick?: (row: TData) => void;
  emptyMessage?: string;
  skeletonRowCount?: number;
}
```<br><br>The component MUST:<br><br>- Accept a generic type parameter `<TData>` that flows through `ColumnDef<TData>` for type-safe column definitions.<br>- Render `<table>` with full dark theme styling matching existing patterns (see Current Styling below).<br>- Call `useReactTable` internally with `getCoreRowModel`, `getSortedRowModel` (default `manualSorting: true` but fallback in-memory sorting when `onSortingChange` is NOT provided), `getPaginationRowModel` (client-side only, disabled when `pageCount` is provided).<br>- Show skeleton placeholder rows when `isLoading` is true (skeleton columns match the column count; each cell is a `animate-pulse bg-white/5 rounded` div).<br>- Show `emptyMessage` centered in a single row spanning all columns when data is empty and not loading.<br>- Render `header` content above the table if provided.<br>- Call `onRowClick` with the row's original `TData` when a row body is clicked (cursor changes to pointer).<br>- Be resilient to empty `data` + `isLoading: false` (shows empty state, not crash).<br>- Be resilient to `undefined` columns (no-op render, no crash).<br><br>**Current Styling Pattern** (must match):<br><br>- Container: `bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl`<br>- Table: `w-full text-left border-collapse`<br>- Thead: `bg-night/50 text-[10px] uppercase text-blue-light font-bold` with `<th className="p-4">`<br>- Th sort indicator: when column is sorted, show the sort arrow icon (`ArrowUpDown`, `ArrowUp`, `ArrowDown` from lucide-react)<br>- Tbody: `divide-y divide-white/5`<br>- Tr: `hover:bg-white/[0.02] transition-colors` (add `cursor-pointer` when `onRowClick` provided)<br>- Td: `p-4`<br>- Scroll wrapper: `<div className="overflow-x-auto">` wrapping the `<table>`<br>- Pagination: Previous/Next buttons with `bg-state-gray rounded-xl border border-white/5`, page info text in `text-blue-light`. Disabled buttons use `opacity-30`.<br>- Empty state: `<td colSpan={all} className="p-12 text-center text-sm text-blue-light italic">`<br><br>**Keyboard accessibility**:<br>- Sortable column headers are `<button>` elements (not just clickable `<th>`) with `aria-label="Sort by {column name}"`<br>- Pagination buttons have `aria-label="Previous page"` / `"Next page"`<br><br>`bunx tsc -b` in `apps/admin-web` passes. |

#### PH2-REQ-004: Fix Hook `any` Types

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-004 |
| **Title** | Fix Hook `any` Types — `catch` to `unknown` |
| **Description** | Replace `catch (err: any)` with `catch (err: unknown)` in `useProductLock.ts` and `useDisputeActions.ts`. Add proper type guards where `err.message` is accessed (use `err instanceof Error` check). Remove the file-level `eslint-disable @typescript-eslint/no-explicit-any` from both files. |
| **Acceptance Criteria** | Both `useProductLock.ts` and `useDisputeActions.ts` have zero eslint-disable comments. All `catch` clauses use `unknown` parameter with type guards. Error messages accessed via `err instanceof Error ? err.message : 'Unknown error'` pattern. Hook behavior is unchanged — lock acquisition/release, dispute resolution, toast notifications all work identically. `bunx tsc -b` in `apps/admin-web` passes. |

#### PH2-REQ-005: Fix UI Component `any` Types

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-005 |
| **Title** | Fix UI Component `any` Types |
| **Description** | Audit `apps/admin-web/src/components/ui/` for any lingering `any` types or `eslint-disable` comments. The following components must be clean:<br><br>- **`StatCard.tsx`**: Already clean — no changes needed. Verify no eslint-disable.<br>- **`StatusBadge.tsx`**: Replace `status: StatusType \| string` with just `status: StatusType`. The union with `string` defeats type safety. If runtime values outside `StatusType` exist from API data, narrow to `status: string` with runtime validation or keep the union but remove eslint-disable (already none).<br>- **`UserAvatar.tsx`**: Already clean — no changes needed. Verify no eslint-disable.<br>- **`SecureImage.tsx`**: Already clean — no changes needed. Verify no eslint-disable.<br>- **`ErrorState.tsx`**: Already clean — no changes needed. Verify no eslint-disable.<br> |
| **Acceptance Criteria** | Zero `eslint-disable @typescript-eslint/no-explicit-any` comments exist in any file under `apps/admin-web/src/components/ui/`. `bunx tsc -b` passes. |

#### PH2-REQ-006: Remove `eslint-disable` from Non-Table Files

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-006 |
| **Title** | Remove `eslint-disable @typescript-eslint/no-explicit-any` from Non-Table Source Files |
| **Description** | Remove file-level and inline `eslint-disable @typescript-eslint/no-explicit-any` from all non-table files in `apps/admin-web/src/`. This includes:<br><br>- `apps/admin-web/src/pages/UsersPage.tsx` — replace `user: any` with `AdminUser` type, remove file-level disable<br>- `apps/admin-web/src/pages/DisputesPage.tsx` — replace `filter as any` cast with proper union type, remove file-level disable<br>- `apps/admin-web/src/components/features/users/UserCard.tsx` — replace inline `// eslint-disable-next-line` by typing `user: AdminUser`<br>- `apps/admin-web/src/components/features/users/UserBankCard.tsx` — replace inline by typing `bank: Tables<'seller_bank_accounts'>`<br>- `apps/admin-web/src/components/features/users/UserReviewsList.tsx` — already no disable, but replace `rev: any` with a proper `Review` interface or inline type<br>- `apps/admin-web/src/components/features/users/UserReportsList.tsx` — replace `reports: any[]` with typed interface<br>- `apps/admin-web/src/components/features/users/UserDisputesList.tsx` — replace `disputes: any[]` with typed interface<br>- `apps/admin-web/src/components/features/users/UserAddressesList.tsx` — replace `addresses: any[]` with `Tables<'addresses'>[]`<br>- `apps/admin-web/src/components/features/users/UserAdminHistory.tsx` — replace `logs: any[]`, `notes: any[]` with typed interfaces<br>- `apps/admin-web/src/components/features/verify/UserSafetyActions.tsx` — replace inline with proper `user` interface<br><br>This requirement covers only non-table files. Table component files (`*Table.tsx`, `*Table.ts`) are handled in PR 2. |
| **Acceptance Criteria** | `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/ --include='*.tsx' --include='*.ts'` returns zero matches (outside table component files). `bunx tsc -b` passes. No visual or behavioral change in any UI. |

---

### PR 2 — Table Migration

#### PH2-REQ-007: Migrate `InventoryTable` to DataTable

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-007 |
| **Title** | Migrate InventoryTable to DataTable |
| **Description** | Rewrite `apps/admin-web/src/components/features/users/InventoryTable.tsx` to use `DataTable<Product>` instead of hand-rolled HTML `<table>`. |
| **Acceptance Criteria** | Component uses `<DataTable<Product>>` with 4 columns: "Producto" (image thumbnail + name), "Precio" (formatted currency), "Estatus" (StatusBadge), "Fecha" (formatted date). Header slot shows title "Inventario Reciente" with count. Pagination at bottom. Empty state shows "Este usuario no tiene productos registrados." Visual appearance is identical to current implementation. `bunx tsc -b` passes. |

#### PH2-REQ-008: Migrate `PurchasesTable` to DataTable

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-008 |
| **Title** | Migrate PurchasesTable to DataTable |
| **Description** | Rewrite `apps/admin-web/src/components/features/users/PurchasesTable.tsx` to use `DataTable<OrderItemWithProduct>` instead of hand-rolled HTML `<table>`. |
| **Acceptance Criteria** | Component uses `<DataTable<OrderItemWithProduct>>` with 4 columns: "Producto" (image + name), "Precio Pagado" (formatted currency), "Estado Orden" (StatusBadge from `order.status`), "Fecha" (formatted date). Header slot shows title "Compras Recientes" with count. Empty state shows nothing (no items = no section shown — match current behavior where component returns empty fragment when items is empty). `bunx tsc -b` passes. |

#### PH2-REQ-009: Migrate `UserTransactionsTable` to DataTable

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-009 |
| **Title** | Migrate UserTransactionsTable to DataTable |
| **Description** | Rewrite `apps/admin-web/src/components/features/users/UserTransactionsTable.tsx` to use `DataTable<WalletTransaction>` instead of hand-rolled HTML `<table>`. This is the most complex table — 7 columns with conditional coloring. |
| **Acceptance Criteria** | Component uses `<DataTable<WalletTransaction>>` with 7 columns: "Fecha" (locale date+time, left-aligned), "Tipo / Descripción" (icon + label + description), "Monto Bruto" (right-aligned, formatted), "Comisión Selene" (right-aligned, conditional — show `-$fee` in `text-fire` if > 0, else `—` dash), "Costo Envío" (right-aligned, same conditional pattern), "Neto" (right-aligned, bold, colored: positive=`text-forest` with `+` prefix, negative=`text-fire`, zero=`text-platinum`), "Saldo Final" (right-aligned, `text-lion` font-mono, `bg-white/[0.02]` background). Header slot shows "Historial de Movimientos (Ledger)". Empty state shows icon + "No se han registrado movimientos financieros aún." Type annotations for `t.type` use `WalletTransaction['type']` for the `getTypeLabel` switch. All existing visual behaviors (coloring, formatting, icon mapping) are preserved exactly. `bunx tsc -b` passes. |

#### PH2-REQ-010: Migrate `UserPayoutsTable` to DataTable

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-010 |
| **Title** | Migrate UserPayoutsTable to DataTable |
| **Description** | Rewrite `apps/admin-web/src/components/features/users/UserPayoutsTable.tsx` to use `DataTable<PayoutRequest>` instead of hand-rolled HTML `<table>`. |
| **Acceptance Criteria** | Component uses `<DataTable<PayoutRequest>>` with 3 columns: "Monto" (bold, formatted currency), "Estatus" (StatusBadge), "Fecha" (formatted request date or "N/A"). Header slot shows "Historial de Retiros". Scrollable container with `max-h-[300px]` maintained (applied to the DataTable wrapper). Empty state shows "No hay retiros registrados." `bunx tsc -b` passes. |

#### PH2-REQ-011: Migrate `DisputesTable` to DataTable

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-011 |
| **Title** | Migrate DisputesTable to DataTable |
| **Description** | Rewrite `apps/admin-web/src/components/features/disputes/DisputesTable.tsx` to use `DataTable<DisputeSummary>` instead of hand-rolled HTML `<table>`. Maintain the action button column and loading state. |
| **Acceptance Criteria** | Component uses `<DataTable<DisputeSummary>>` with 6 columns: "Reporte" (calendar icon + date), "Orden / Monto" (truncated order ID + amount), "Involucrados" (buyer@ + seller@), "Motivo" (reason preview, underscore-to-space), "Estatus" (StatusBadge), "Acción" (right-aligned ChevronRight button calling `onViewDetails`). Row click handler calls `onViewDetails` (same as action button). Loading state shows skeleton rows (not spinner overlay). Empty state shows "Bandeja de entrada vacía. No hay casos pendientes." with Gavel icon. `isLoading` prop drives `DataTable`'s `isLoading`. `bunx tsc -b` passes. |

#### PH2-REQ-012: Clean `UsersPage` Data Access Types

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-012 |
| **Title** | Clean UsersPage Data Access Types |
| **Description** | The current `UsersPage.tsx` uses a card grid (`UserCard` components), NOT an HTML table. Evaluate whether to replace the card grid with `DataTable<AdminUser>` or keep the cards with proper typing. |
| **Acceptance Criteria** | A decision is documented (in code or a brief comment at the top of the file). **Option A (recommended)**: Keep the card grid, replace `user: any` with `AdminUser` in the map callback. Remove file-level eslint-disable. **Option B**: Replace card grid with `DataTable<AdminUser>`. If Option B is chosen, ensure the visual redesign doesn't lose the user avatar, stats badges, and click-anywhere navigation that cards provide. Either way: zero eslint-disable comments, zero `any`, `bunx tsc -b` passes. Existing pagination controls remain functional. |

#### PH2-REQ-013: Clean `VerificationPage` Data Access Types

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-013 |
| **Title** | Clean VerificationPage Data Access Types |
| **Description** | The current `VerificationPage.tsx` uses a card-based product list (left sidebar), NOT an HTML table. Evaluate whether to replace the product list with `DataTable<PendingProduct>` or keep the cards with proper typing. |
| **Acceptance Criteria** | A decision is documented. **Option A (recommended)**: Keep the card list as-is (it has rich layout semantics — image, category badge, price, seller info, time-in-queue — that a table cell can't match without excessive nesting). Replace all `any` types with `PendingProduct`. Remove file-level eslint-disable (already none — the file currently has NO eslint-disable). Type the `resolve.mutate` call properly. **Option B**: Replace the left card list with `DataTable<PendingProduct>`. Either way: zero `any`, zero eslint-disable, `bunx tsc -b` passes. |

#### PH2-REQ-014: Clean `DisputesPage` Data Access Types

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-014 |
| **Title** | Clean DisputesPage Data Access Types |
| **Description** | The current `DisputesPage.tsx` uses the `DisputesTable` component (which will be migrated in PH2-REQ-011). Remove the file-level eslint-disable and fix the `filter as any` cast on line 44. |
| **Acceptance Criteria** | File-level eslint-disable removed. `setFilter(id as any)` replaced with a properly typed `setFilter(id as 'open' | 'resolved' | 'all')` or a typed helper function. `bunx tsc -b` passes. |

#### PH2-REQ-015: Card-List Migration Decision

| Field | Value |
|-------|-------|
| **ID** | PH2-REQ-015 |
| **Title** | Document Card-List Migration Decision |
| **Description** | Evaluate the 5 card-based list components under `apps/admin-web/src/components/features/users/` and document whether each should be migrated to `DataTable` or stay as cards. |
| **Acceptance Criteria** | A decision record is placed in `apps/admin-web/src/components/features/users/CARD_LIST_DECISION.md` (or at the top of each component file if preferred) covering:<br><br>1. **`UserReviewsList.tsx`** — Card grid with pagination. **Decision**: STAY AS CARDS. Each review has rich layout (avatar, star rating, comment text, date) that a table would flatten into unnatural columns. The card layout is the correct UX for this data.<br>2. **`UserReportsList.tsx`** — Vertical card list. **Decision**: STAY AS CARDS. Reports are structured as feed items with reporter info, reason text, and status — a table would add no value.<br>3. **`UserDisputesList.tsx`** — Vertical card list with per-user outcome coloring. **Decision**: STAY AS CARDS. The `getUserOutcome` logic produces rich winner/loser badges per user — this is UI logic that belongs in a card, not a generic table cell.<br>4. **`UserAddressesList.tsx`** — Card list. **Decision**: STAY AS CARDS. Addresses are structured documents (street, city, state, zip, phone, label) that read naturally as cards. A table would require awkward wrapping.<br>5. **`UserAdminHistory.tsx`** — Timeline-like card list. **Decision**: STAY AS CARDS. The action log format (action label + timestamp + admin) is not tabular data — it's an activity feed.<br><br>All 5 components still need their `any` types fixed (covered by PH2-REQ-006). |

---

## Scenarios

### DataTable Component (PH2-REQ-003)

#### S-001: Basic render with data

- **GIVEN** a `DataTable` with `columns` and `data` both populated
- **WHEN** the component renders
- **THEN** the table header shows all column labels
- **AND** each row in `data` renders as a `<tr>` with the correct cell content
- **AND** the table uses the correct dark theme styling

#### S-002: Loading state with skeletons

- **GIVEN** `isLoading` is `true`
- **WHEN** the component renders
- **THEN** skeleton placeholder rows render (one per `skeletonRowCount`, default 5)
- **AND** each skeleton cell has `animate-pulse bg-white/5 rounded` classes
- **AND** no data rows are visible

#### S-003: Empty data (not loading)

- **GIVEN** `data` is an empty array and `isLoading` is `false`
- **WHEN** the component renders
- **THEN** a single row spanning all columns shows
- **AND** the row displays `emptyMessage` (default: "No hay datos disponibles.")
- **AND** the text is centered, italic, `text-blue-light`

#### S-004: Row click handler

- **GIVEN** `onRowClick` is provided
- **WHEN** the user clicks a data row
- **THEN** `onRowClick` is called with the row's original `TData` value
- **AND** the cursor changes to pointer on hover over the row

#### S-005: Client-side sorting

- **GIVEN** `onSortingChange` is NOT provided
- **WHEN** the user clicks a sortable column header
- **THEN** the table toggles ascending/descending sort for that column
- **AND** the column header shows the sort direction arrow
- **AND** rows reorder accordingly

#### S-006: Manual (controlled) sorting

- **GIVEN** `sorting` and `onSortingChange` are provided
- **WHEN** the user clicks a sortable column header
- **THEN** `onSortingChange` is called with the new `SortingState`
- **AND** the table does NOT reorder rows internally (defers to parent)

#### S-007: Client-side pagination

- **GIVEN** no `pageCount` prop is provided
- **WHEN** data has more rows than the default page size (10)
- **THEN** pagination controls render below the table
- **AND** "Previous" button is disabled on page 1
- **AND** "Next" button is disabled on the last page
- **AND** page info shows "Mostrando página X de Y"

#### S-008: Full data (no pagination needed)

- **GIVEN** data has fewer rows than page size
- **WHEN** the component renders
- **THEN** all rows render without pagination controls

#### S-009: Header slot

- **GIVEN** `header` prop is provided (e.g., a `<div>` with title and count)
- **WHEN** the component renders
- **THEN** the header content renders above the scrollable table wrapper
- **AND** it is separated from the table by a bottom border (`border-b border-white/5`)

#### S-010: Resilient to undefined/null data

- **GIVEN** `data` is `undefined` or `null`
- **WHEN** the component renders
- **THEN** it treats missing data as empty array and shows the empty state
- **AND** does not crash

#### S-011: Paginated controlled mode

- **GIVEN** `pagination`, `onPaginationChange`, and `pageCount` are provided
- **WHEN** the user clicks "Next"
- **THEN** `onPaginationChange` is called with the updated `PaginationState`
- **AND** the table does NOT auto-advance pages internally

#### S-012: Column header accessibility

- **GIVEN** a sortable column
- **WHEN** the column header renders
- **THEN** it is a `<button>` element with `aria-label="Sort by {column name}"`
- **AND** it is keyboard-focusable and activatable via Enter/Space

#### S-013: Pagination accessibility

- **GIVEN** pagination controls are visible
- **WHEN** they render
- **THEN** the "Previous" button has `aria-label="Previous page"`
- **AND** the "Next" button has `aria-label="Next page"`

---

### Table Migrations (PH2-REQ-007 through PH2-REQ-011)

#### S-100: InventoryTable — visual parity

- **GIVEN** the same `products` array
- **WHEN** rendered before and after migration
- **THEN** the column count, header labels, cell content, and styling are visually identical
- **AND** the image thumbnail + name column renders the same way

#### S-101: UserTransactionsTable — net amount coloring

- **GIVEN** transactions with positive, negative, and zero net amounts
- **WHEN** rendered in the migrated DataTable
- **THEN** positive net values show with `+` prefix and `text-forest` color
- **AND** negative net values show with `text-fire` color
- **AND** zero net values show with `text-platinum` color

#### S-102: DisputesTable — action button and row click

- **GIVEN** a list of disputes
- **WHEN** the user clicks the action button (ChevronRight)
- **THEN** `onViewDetails` is called with the correct dispute ID
- **AND** clicking anywhere on the row also calls `onViewDetails`

#### S-103: UserPayoutsTable — scroll behavior

- **GIVEN** more payouts than fit in 300px
- **WHEN** the component renders
- **THEN** the table body scrolls with `max-h-[300px]`
- **AND** the header remains visible

---

### Type Cleanup (PH2-REQ-004, PH2-REQ-005, PH2-REQ-006)

#### S-200: Hook catch blocks — unknown error type

- **GIVEN** `useProductLock.acquireLock` throws a non-Error object (e.g., a string)
- **WHEN** the `catch` block executes
- **THEN** `err instanceof Error` check prevents crash on `.message` access
- **AND** the block falls back to `'Unknown error'`
- **AND** `toast.error` is still called with a sensible message

#### S-201: Hook catch blocks — network error

- **GIVEN** `useDisputeActions.releaseLock` throws an `Error`
- **WHEN** the `catch` block executes
- **THEN** `err.message` is safely accessed via `instanceof Error` guard
- **AND** the lock is silently released (current behavior preserved)

#### S-202: eslint-disable removal — no new type errors

- **GIVEN** a file with `eslint-disable @typescript-eslint/no-explicit-any` removed
- **WHEN** `bunx tsc -b` runs
- **THEN** no new type errors appear that weren't there before
- **AND** the file has valid types for every value that was previously `any`

---

## Constraints

### Type Safety

- **Zero tolerance for `any`**: All 14+ files with `eslint-disable @typescript-eslint/no-explicit-any` must be cleaned. After Phase 2 PR 2 is merged, `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/` returns zero matches across ALL files.
- **`unknown` over `any`**: Where a value's type is truly unknown (e.g., catch clause, JSON.parse), use `unknown` with type guards — never `any`.
- **Prefer generated types**: Always use `Tables<'...'>` and `Enums<'...'>` from `packages/types` before creating ad-hoc interfaces. Only create new interfaces for joined/view shapes that don't map to a single table.
- **`tsc -b` must pass**: After each PR, `bunx tsc -b` in `apps/admin-web` exits with code 0.

### Visual Regressions

- **Pixel-perfect parity**: Every migrated table must look identical to its predecessor. Compare screenshots side-by-side if possible.
- **No layout shifts**: The table wrapper, header, pagination, and scroll container must have the same dimensions and behavior.
- **Dark theme consistency**: All DataTable instances use the same styling tokens as the existing tables. No color or spacing drifts.

### Data Contracts

- **No API changes**: The migration does NOT change any Supabase query, RPC call, or hook return type. The `data` arrays flowing into components remain the same shape.
- **No new queries**: The DataTable uses client-side sorting and pagination unless the existing component already used server-side. If a table starts with server-side pagination, the DataTable wrapper in that component must use the controlled pagination props (`pagination`, `onPaginationChange`, `pageCount`).

### Performance

- **No double render**: The DataTable should not cause unnecessary re-renders. Memoize `columns` definitions with `useMemo` or define them outside the component where possible.
- **Skeleton performance**: Skeleton rows are plain divs with CSS animation — no state, no effects. They should not cause layout thrashing.

### Code Quality

- **No new eslint-disable**: Once removed, eslint-disable comments must not be re-added to any file in `apps/admin-web/src`.
- **Console.log removal**: Ensure no debug `console.log` calls are introduced in the migration.
- **Consistent naming**: Table column definitions use `accessorKey` where the field name matches the type, and `accessorFn` only when a transformation is needed (e.g., formatting, nested access).

---

## Verification Criteria

### PR 1 — Foundation (Independent Verification)

| Criterion | Method | Pass/Fail |
|-----------|--------|-----------|
| DB types regenerated | `bun db:types` exits 0. Diff shows only expected changes. | |
| Enriched types exist | `grep 'interface PendingProduct' packages/types/src/index.ts` returns non-empty. Same for `AdminUser`, `DisputeSummary`, `OrderItemWithProduct`, `AdminAuditLog`. | |
| DataTable component exists | File exists at `apps/admin-web/src/components/ui/DataTable.tsx`. | |
| DataTable type-checks | `bunx tsc -b` in `apps/admin-web` exits 0. | |
| Hook catch blocks use `unknown` | `grep -n 'catch.*any' apps/admin-web/src/hooks/useProductLock.ts apps/admin-web/src/hooks/useDisputeActions.ts` returns zero matches. | |
| UI components have no eslint-disable | `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/components/ui/` returns zero matches. | |
| Non-table eslint-disable removed | `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/ --include='*.tsx' --include='*.ts' \| grep -v 'Table.tsx'` returns zero matches. | |
| Full type-check passes | `bunx tsc -b` in `apps/admin-web` exits 0. | |

### PR 2 — Table Migration (Independent Verification)

| Criterion | Method | Pass/Fail |
|-----------|--------|-----------|
| InventoryTable migrated | `grep -c 'DataTable' apps/admin-web/src/components/features/users/InventoryTable.tsx` >= 1. No HTML `<table>` remains. | |
| PurchasesTable migrated | Same check. | |
| UserTransactionsTable migrated | Same check. Net coloring preserved — compare row render output for positive/negative/zero amounts. | |
| UserPayoutsTable migrated | Same check. Scroll height preserved. | |
| DisputesTable migrated | Same check. Action button and row click both call `onViewDetails`. | |
| UsersPage types clean | File has no eslint-disable. `user` in map callback typed as `AdminUser`. | |
| VerificationPage types clean | File has no eslint-disable. All `any` references replaced with `PendingProduct`. | |
| DisputesPage types clean | File has no eslint-disable. `filter as any` removed. | |
| Card-list decision documented | File `CARD_LIST_DECISION.md` or equivalent exists with decisions for all 5 components. | |
| Zero eslint-disable project-wide | `grep -r 'eslint-disable.*no-explicit-any' apps/admin-web/src/ --include='*.tsx' --include='*.ts'` returns zero matches across ALL files. | |
| Full type-check passes | `bunx tsc -b` in `apps/admin-web` exits 0. | |
| Build passes | `bun run build` in `apps/admin-web` exits 0. | |

---

## Phasing Notes

### Edge Cases and Gotchas

1. **`UserTransactionsTable` type mapping**: The `getTypeLabel` function uses `'sale_proceeds' | 'payout' | 'refund' | 'adjustment' | 'release'` as literal keys. Before migrating, verify these match the actual `wallet_transactions.type` enum values in `database.types.ts`. If the enum has different values, adjust the function accordingly.

2. **`DisputesTable` data shape**: The current component accesses `d.dispute_id`, `d.dispute_date`, `d.order_id`, `d.total_amount`, `d.buyer_username`, `d.seller_username`, `d.dispute_reason_preview`, `d.dispute_status` — these come from the `admin_disputes_monitor_view`, NOT the raw `disputes` table. The `DisputeSummary` interface must match this view's columns.

3. **`PurchasesTable` `items[].orders?.status`**: The current code accesses `item.orders?.status` — this is a nested join. The `OrderItemWithProduct` type must include the nested `orders: Pick<Order, 'status'>` field.

4. **`UsersPage` pagination**: The current UsersPage has its own pagination controls (Previous/Next buttons with page tracking). If migrated to DataTable, the pagination must integrate with the existing server-side pagination via `useUsers(search, page, statusFilter, sortBy)`.

5. **`StatusBadge` `StatusType | string`**: The union with `string` was likely added because some API responses contain status values not covered by the literal union. Before narrowing, check if any runtime status values exist outside the defined `StatusType`. If yes, prefer adding the missing values to `StatusType` rather than keeping `string`.

### Out of Scope for This Spec

- Phase 3 concerns (component breakdown of VerificationPage, responsive sidebar)
- Error boundaries (Phase 5)
- Loading skeletons for non-table components (Phase 5)
- Virtualization (Phase 5)
- KPI dashboard enhancements (Phase 4)
- Aesthetic polish (Phase 6)
