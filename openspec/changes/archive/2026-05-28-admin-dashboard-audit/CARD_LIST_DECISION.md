# Card-List Migration Decision

**Date**: 2026-05-28
**Phase**: 2 (Type Safety & TanStack Table Migration)
**Spec**: PH2-REQ-015

## Decision

All 5 card-based list components **STAY AS CARDS**. They are NOT migrated to `DataTable<TData>`.

## Rationale Per Component

### 1. `UserReviewsList.tsx` — STAY AS CARD

- **Layout**: Card grid with avatar, star rating, comment text, date
- **Why not a table**: Each review has rich layout semantics (avatar + username row, 5-star visual rating, italicized comment block, date footer) that `<td>` cells would flatten into awkward columns. A table would require excessive custom cell nesting to match the card's natural visual hierarchy.
- **Changes**: `rev: any` replaced with typed `Review` inline interface.

### 2. `UserReportsList.tsx` — STAY AS CARD

- **Layout**: Vertical feed list with reporter info, reason text, status
- **Why not a table**: Reports are structured as feed items (reporter badge, quoted reason, status capsule) — table columns would add no value and the vertical card layout provides better readability for narrative text.
- **Changes**: `reports: any[]` replaced with typed `Report` inline interface.

### 3. `UserDisputesList.tsx` — STAY AS CARD

- **Layout**: Vertical card list with per-user outcome coloring
- **Why not a table**: The `getUserOutcome` function produces rich winner/loser badges per user (`Ganada`/`Perdida` with conditional colors) based on comparing `resolution_type` against `currentUserId`. This is UI logic that belongs in a card renderer, not a generic table cell. The card also shows role badges (`Vendedor`/`Comprador`) that would be lost in a table.
- **Changes**: `disputes: any[]` replaced with typed inline `DisputeWithOutcome` interface.

### 4. `UserAddressesList.tsx` — STAY AS CARD

- **Layout**: Card grid with structured address document
- **Why not a table**: Addresses are structured documents (label, street, district, city, state, country, zip, phone, default badge) that read naturally as cards. A table would require awkward multi-line cell wrapping to display the address text, and the visual "default" badge + border highlight is cleaner on cards.
- **Changes**: `addresses: any[]` replaced with `Tables<'addresses'>[]`.

### 5. `UserAdminHistory.tsx` — STAY AS CARD

- **Layout**: Timeline-like stacked cards
- **Why not a table**: The action log format (action label + timestamp + admin name) is an activity feed, not tabular data. The two-section layout (audit log + intelligence notes) has fundamentally different structures. A table cannot represent two separate data streams in the same component without confusing column alignment.
- **Changes**: `logs: any[]` replaced with `AdminAuditLog[]`, `notes: any[]` replaced with typed inline interface.

## Future Considerations

If any of these components outgrow their card format (e.g., admin needs to sort/filter reviews in a spreadsheet-like view), they can be migrated to `DataTable` individually. The decision should be reevaluated when:

- The component needs column-based sorting
- The component needs server-side pagination
- The data needs to be exported to CSV
- The card layout causes performance issues with large datasets (>100 items)
