# Delta for `admin-product-management`

## Purpose

This delta adds server-side filtering, debounced search, and count badges to
`ProductManagementPage`. The eight `product_status_enum` values are grouped:

| Tab     | Statuses                                     |
| ------- | -------------------------------------------- |
| Active  | `VERIFIED`, `RESERVED`, `IN_DISPUTE`         |
| History | `SOLD`, `REJECTED`, `HIDDEN`                 |

`PENDING_VERIFICATION` and `IN_REVIEW` are excluded (live on VerificationPage).
Groups live as module-level constants (`ACTIVE_STATUSES`, `HISTORY_STATUSES`).
`REQ-APM-001`…`REQ-APM-004` are preserved without regression.

## ADDED Requirements

### Requirement: Server-Side Status Tabs

The page SHALL render two mutually-exclusive tabs via `useState<ActiveTab>('active')`.
The list query SHALL use `queryKey: ['admin-products', tab]` and filter with
`.in('status', ACTIVE_STATUSES | HISTORY_STATUSES)`. `placeholderData: keepPreviousData`
SHALL keep prior rows visible during fast switches.

#### Scenario: Active tab filter

- GIVEN the page loads
- WHEN Active is selected
- THEN the query filters `.in('status', ['VERIFIED', 'RESERVED', 'IN_DISPUTE'])`
- AND no `SOLD`/`HIDDEN`/`PENDING_VERIFICATION` row is rendered

#### Scenario: History tab filter

- GIVEN Active is selected
- WHEN the admin clicks History
- THEN the query filters `.in('status', ['SOLD', 'REJECTED', 'HIDDEN'])`

#### Scenario: Fast switch keeps prior data

- GIVEN Active is rendering 20 rows
- WHEN the admin clicks History twice within 300ms
- THEN the Active rows SHALL remain visible until History resolves
- AND no full-page skeleton SHALL be shown

### Requirement: Per-Tab Count Badges

A `useAdminProductCounts` hook SHALL issue two parallel `head: true` count queries
via `Promise.all` with `queryKey: ['admin-products-counts']`. Badges update after
every soft-delete/restore.

#### Scenario: Initial badge values

- GIVEN 12 active and 47 history products exist
- WHEN the page loads
- THEN Active reads "12" and History reads "47"

#### Scenario: Soft-delete updates badges

- GIVEN History reads "47"
- WHEN the admin soft-deletes a `VERIFIED` product
- THEN History SHALL read "48" and Active SHALL read "11" after refetch

#### Scenario: Count failure is non-blocking

- GIVEN the list resolves
- WHEN the count query rejects
- THEN the list SHALL render and the badges SHALL show "—"

### Requirement: Server-Side Debounced Search

A search input SHALL feed `useDebounce(value, 300)`. The debounced value SHALL be
appended to the list query key (`['admin-products', tab, debouncedSearch]`) and
applied server-side via `.textSearch('fts', term, { type: 'websearch' })`, scoped to the
current tab's status group. `pageParam` SHALL reset to `0` on search change.

#### Scenario: Debounce coalesces keystrokes

- GIVEN the admin types "gtx" character by character
- WHEN the third char is typed
- THEN exactly one Supabase request fires, 300ms after the last keystroke

#### Scenario: OR filter is server-side

- GIVEN debounced search is "3060" on Active
- WHEN the query fires
- THEN the WHERE clause combines `.textSearch('fts', '3060', { type: 'websearch' })` AND `.in('status', ACTIVE_STATUSES)`

#### Scenario: Search resets pagination

- GIVEN the admin is on page 2
- WHEN the search input changes
- THEN `pageParam` resets to `0` and the table renders page 1 of the filtered set

#### Scenario: Search cancels in-flight request

- GIVEN the initial query is in flight
- WHEN the admin types a search term
- THEN the in-flight query is cancelled
- AND a new query fires after 300ms with the new key

### Requirement: Accessible Tab UI

The tab strip SHALL implement the WAI-ARIA tabs pattern: a parent `role="tablist"`
with two native `<button type="button">` children carrying `role="tab"`,
`aria-selected`, `aria-controls`, and a unique `id`. The panel SHALL have
`role="tabpanel"`, `aria-labelledby`, and a polite `aria-live` region announcing
"Mostrando N productos". Keys: `ArrowLeft`/`ArrowRight` (wrap), `Home`/`End`,
`Enter`/`Space`. Focus moves to the newly-selected tab.

#### Scenario: Tablist semantics

- GIVEN the page renders
- WHEN inspected with assistive tech
- THEN exactly one `role="tablist"`, two `role="tab"`, and the active has `aria-selected="true"`

#### Scenario: Arrow-key navigation

- GIVEN focus is on Active
- WHEN `ArrowRight` is pressed
- THEN focus moves to History, `aria-selected` updates, and the History panel becomes visible

#### Scenario: Live region announces count

- GIVEN the panel has `aria-live="polite"`
- WHEN the count changes 0 → 12
- THEN the region SHALL read "Mostrando 12 productos"

#### Scenario: Native button activation

- GIVEN focus is on a tab
- WHEN `Enter` or `Space` is pressed
- THEN the click handler fires WITHOUT `event.preventDefault()`

### Requirement: Empty States Per Tab

A distinct empty state SHALL render when the filtered list is empty. Copy comes
from the (tab, hasSearch) matrix:

| State                | Copy                            |
| -------------------- | ------------------------------- |
| Active + no search   | "No hay productos activos"      |
| History + no search  | "No hay productos en historial" |
| Any tab + has search | "No se encontraron resultados"  |

The empty state SHALL live inside the tabpanel so it is announced by the panel's
`aria-live` region.

#### Scenario: Active empty

- GIVEN no active-status products exist
- WHEN Active is selected with empty search
- THEN the empty state SHALL read "No hay productos activos"

#### Scenario: History empty

- GIVEN no terminal products exist
- WHEN History is selected with empty search
- THEN the empty state SHALL read "No hay productos en historial"

#### Scenario: Search empty overrides

- GIVEN History has 47 products
- WHEN the admin types a debounced search that matches none
- THEN the empty state SHALL read "No se encontraron resultados" and mention the term

### Requirement: Preserved Soft-Delete and Restore Behavior

`fn_admin_soft_delete_product` and `fn_admin_restore_product` SHALL operate on the
target row regardless of selected tab. On success each mutation SHALL invalidate
`['admin-products', currentTab]` and `['admin-products-counts']`. The `InputModal`
reason flow (min 5 chars), toasts, and the action button's `aria-label` SHALL be
unchanged from the previous cycle.

#### Scenario: Soft-delete from History

- GIVEN History is selected and a `SOLD` row is visible
- WHEN the admin submits a reason ≥ 5 chars
- THEN the RPC runs, the row leaves the list, and the History badge decrements

#### Scenario: Restore reflected after tab switch

- GIVEN a soft-deleted product was hidden from Active
- WHEN the admin restores it from History
- THEN switching back to Active SHALL show the restored product

#### Scenario: Invalidations are scoped

- GIVEN the Active tab is selected
- WHEN a mutation succeeds
- THEN `['admin-products', 'history']` SHALL NOT be invalidated
- AND `['admin-products', 'active']` and `['admin-products-counts']` SHALL be invalidated

#### Scenario: Modal reason validation unchanged

- GIVEN the dialog is open
- WHEN the reason is fewer than 5 chars
- THEN the confirm button SHALL remain disabled
