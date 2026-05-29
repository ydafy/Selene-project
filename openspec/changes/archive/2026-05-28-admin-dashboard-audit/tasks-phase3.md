# Tasks — Phase 3: Component Breakdown & Responsive Layout

## Change
admin-dashboard-audit / Phase 3

---

### T3.1: Create EvidenceViewer component

**Effort**: S (20-30 min)

**Description**: Create `apps/admin-web/src/components/features/verify/EvidenceViewer.tsx`. Extract the evidence display section from `VerificationPage.tsx` lines 452-515 (physical proof image, benchmark image + score badge, public sale gallery). This is a purely presentational component.

**Actions**:
1. Create `EvidenceViewer.tsx` with `EvidenceViewerProps` interface
2. Move 2-column grid (physical proof + benchmark) with `SecureImage` and score badge
3. Move public gallery horizontal scroll row with hover zoom overlay
4. Fire `onImageClick(url)` on any image click
5. Handle empty/missing images gracefully

**Verification**:
- `tsc -b` passes
- Component renders both evidence types and gallery
- Image click propagates url to parent

**Dependencies**: None

---

### T3.2: Create VerificationActions component

**Effort**: M (30-45 min)

**Description**: Create `apps/admin-web/src/components/features/verify/VerificationActions.tsx`. Extract the admin note textarea and approve/reject button section from `VerificationPage.tsx` lines 590-646, plus the `ConfirmModal` integration. This component manages its own `adminNote` and `confirmData` state.

**Actions**:
1. Create `VerificationActions.tsx` with `VerificationActionsProps` interface
2. Move admin note textarea (label, placeholder, value, onChange)
3. Move Reject button (fire/red, disabled logic)
4. Move Approve button (forest/lion conditional styling, loading spinner)
5. Move ConfirmModal integration (title, description, confirmLabel, onConfirm)
6. Add `onVerdictComplete` callback for parent cleanup after success
7. Import `ConfirmModal` from existing ui component

**Verification**:
- `tsc -b` passes
- Reject opens danger confirm modal
- Approve opens success confirm modal
- Buttons disabled when locked/isLocking/pending
- Loading spinner shows during mutation

**Dependencies**: None

---

### T3.3: Create VerificationList component

**Effort**: M (30-45 min)

**Description**: Create `apps/admin-web/src/components/features/verify/VerificationList.tsx`. Extract the entire left column from `VerificationPage.tsx` — search input, category filters, scrollable product card list, and both empty states. This component manages its own `searchTerm` and `activeCategory` state internally.

**Actions**:
1. Create `VerificationList.tsx` with `VerificationListProps` interface
2. Move search input with Search icon
3. Move category filter bar (ALL/GPU/CPU/RAM/Motherboard) with active state
4. Move scrollable product card list (each card is a button with category badge, price, name, seller avatar, time in queue)
5. Move empty search results state + "Limpiar filtros" button
6. Move zero products state
7. Implement `useMemo` for client-side filtering by search term and category

**Verification**:
- `tsc -b` passes
- Search filters product list
- Category filters product list
- Empty states render correctly
- Selected card is highlighted

**Dependencies**: None

---

### T3.4: Create VerificationDetail component

**Effort**: M (30-45 min)

**Description**: Create `apps/admin-web/src/components/features/verify/VerificationDetail.tsx`. Extract the main detail panel from `VerificationPage.tsx` lines 287-648, composing `EvidenceViewer` and `VerificationActions` internally. Owns its own `showRankInfo` and `internalNote` state.

**Actions**:
1. Create `VerificationDetail.tsx` with `VerificationDetailProps` interface
2. Move lock banner (isLockedByOther)
3. Move rejection reason context
4. Move seller passport section: avatar, username, rank badge + popover, seller ID, UserSafetyActions, trust metrics
5. Move internal notes section (textarea, save button, history)
6. Compose `EvidenceViewer` for the evidence section
7. Move description and `ProductSpecsGrid` section
8. Compose `VerificationActions` for the verdict zone
9. Handle rank popover open/close internally

**Verification**:
- `tsc -b` passes
- All detail sections render with correct data
- Internal notes save works
- Rank popover toggles
- EvidenceViewer and VerificationActions render correctly within

**Dependencies**: T3.1 (EvidenceViewer), T3.2 (VerificationActions)

---

### T3.5: Refactor VerificationPage to orchestrator

**Effort**: M (30-45 min)

**Description**: Strip `VerificationPage.tsx` from ~721 lines to under 200. Keep the header, hook calls, `selectedId`/`activeImage` state, lock management, and `ImageModal`. Remove all extracted code and instead import + compose the 4 sub-components.

**Actions**:
1. Keep `usePendingProducts` and `useProductLock` hook calls
2. Keep `selectedId` state and `useEffect` cleanup for lock release on unmount
3. Keep `activeImage` state and `ImageModal` at page level
4. Keep `handleSelectProduct` (acquire lock → set selectedId)
5. Keep header section (title, subtitle, sync badge, queue count)
6. Remove inline search/filter/list (replaced by `VerificationList`)
7. Remove inline detail panel (replaced by `VerificationDetail`)
8. Remove inline evidence section (replaced by `EvidenceViewer` inside Detail)
9. Remove inline admin notes + approve/reject + ConfirmModal (replaced by `VerificationActions` inside Detail)
10. Add `handleVerdictComplete` callback: releaseLock + setSelectedId(null) + clear state
11. Verify the file is under 200 lines

**Verification**:
- File is under 200 lines
- `tsc -b` passes
- Page renders identically to before extraction
- All existing features work: search, filter, select, lock, view, approve, reject, internal notes, evidence viewing

**Dependencies**: T3.1, T3.2, T3.3, T3.4

---

### T3.6: Make Layout sidebar responsive

**Effort**: M (30-45 min)

**Description**: Modify `apps/admin-web/src/components/layout/Layout.tsx` to make the sidebar collapsible on viewports < 1024px. Add `isSidebarOpen` state, hamburger toggle button, backdrop overlay, and responsive positioning.

**Actions**:
1. Add `isSidebarOpen` useState (default: false)
2. Wrap sidebar `aside` with responsive classes: `fixed lg:static`, `-translate-x-full`/`translate-x-0` with `transition-transform duration-300`, `lg:translate-x-0`
3. Add backdrop `div` (fixed inset-0, z-40, bg-black/50) — only on mobile when sidebar is open
4. Add hamburger button (`Menu` icon from lucide-react) in main content area, `lg:hidden`
5. Change main content from `flex-1` to `flex-1 ml-0 lg:ml-64`
6. Add `setIsSidebarOpen(false)` to each navigation link's onClick
7. Add `setIsSidebarOpen(false)` to backdrop onClick
8. Import `Menu` from lucide-react (or reuse existing import)

**Verification**:
- `tsc -b` passes
- Desktop (>=1024px): sidebar at `w-64`, always visible, no hamburger
- Mobile (<1024px): sidebar hidden by default, hamburger visible, toggle works, backdrop works
- Nav link click closes sidebar on mobile

**Dependencies**: None

---

### T3.7: Fix DisputeDetailPage fixed bottom bar

**Effort**: XS (5-10 min)

**Description**: Change the `left-64` class on the fixed bottom bar in `DisputeDetailPage.tsx` to `left-0 lg:left-64` so it respects the responsive sidebar.

**Actions**:
1. In `apps/admin-web/src/pages/DisputeDetailPage.tsx` line 324, change `left-64` to `left-0 lg:left-64`

**Verification**:
- `tsc -b` passes
- Bottom bar renders at `left-64` on desktop, `left-0` on mobile
- No visual change on desktop

**Dependencies**: T3.6 (responsive layout must be in place for this change to be meaningfully tested)

---

## Task Dependency Graph

```
T3.1 (EvidenceViewer) ─┐
                        ├── T3.4 (VerificationDetail) ──┐
T3.2 (VerifyActions) ───┘                               │
                                                        ├── T3.5 (Orchestrator)
T3.3 (VerificationList) ────────────────────────────────┘

T3.6 (Responsive Layout) ─── T3.7 (Fix bottom bar)
```

## Summary

| Task | File(s) | Est. Lines | Effort | Deps |
|---|---|---|---|---|
| T3.1 Create EvidenceViewer | `EvidenceViewer.tsx` (new) | ~50 | S | — |
| T3.2 Create VerificationActions | `VerificationActions.tsx` (new) | ~90 | M | — |
| T3.3 Create VerificationList | `VerificationList.tsx` (new) | ~100 | M | — |
| T3.4 Create VerificationDetail | `VerificationDetail.tsx` (new) | ~120 | M | T3.1, T3.2 |
| T3.5 Refactor VerificationPage | `VerificationPage.tsx` (modify) | ~-520 | M | T3.3, T3.4 |
| T3.6 Responsive sidebar | `Layout.tsx` (modify) | ~50 | M | — |
| T3.7 Fix bottom bar | `DisputeDetailPage.tsx` (modify) | ~1 | XS | T3.6 |
| **Total** | | **~+210** | | |
