# Specs: Dashboard Bug Fixes

**Change**: `dashboard-bug-fixes`
**Date**: 2026-05-29
**Priority**: HIGH (DKB-001, DKB-002, DKB-004) | MEDIUM (DKB-003)

---

## DKB-001 — Replace raw `<img>` with SecureImage

### Description

`InventoryTable.tsx`, `PurchasesTable.tsx`, and `EvidenceViewer.tsx` render product images using raw `<img>` tags with storage paths directly as `src` (e.g., `product-photos/uuid/image.jpg`). Supabase Storage buckets are private — raw paths do NOT render in the browser. The existing `SecureImage` component already handles signed URL generation correctly.

Replace all raw `<img>` references with `<SecureImage>` in these 3 files.

### Acceptance Criteria

1. `InventoryTable.tsx` replaces `<img src={row.original.images?.[0]}>` with `<SecureImage>` — product thumbnails render correctly.
2. `PurchasesTable.tsx` replaces `<img src={row.original.images?.[0]}>` with `<SecureImage>` — product thumbnails render correctly.
3. `EvidenceViewer.tsx` gallery replaces `<img src={img}>` loop with `<SecureImage>` — gallery images render correctly with preserved `onClick` zoom behavior.
4. Each `<SecureImage>` uses the correct `bucket` prop (`verification` for product photos).
5. TypeScript compiles with zero errors.
6. No visual regression in table layout — thumbnails maintain `w-10 h-10 rounded-lg object-cover` sizing.

### Related Files

- `src/components/features/users/InventoryTable.tsx`
- `src/components/features/users/PurchasesTable.tsx`
- `src/components/features/verify/EvidenceViewer.tsx`
- `src/components/ui/SecureImage.tsx`

---

## DKB-002 — Add error state to SecureImage and SecureVideo

### Description

`SecureImage.tsx` and `SecureVideo.tsx` show a CSS skeleton loader (`animate-pulse`) while `url` is `null`. There are three failure modes where `url` stays `null` forever:

1. `createSignedUrl()` returns an error — silently ignored (`if (data)` guard)
2. `<img>` / `<video>` element fails to load the signed URL (network error, expired URL) — no `onError` handler
3. `path` prop is empty string — `useEffect` returns early, `url` stays `null`

The skeleton loader spins indefinitely in all three cases with no error indication.

Add an `error` state to both components. Handle the `createSignedUrl` error case and add `onError` handlers to `<img>` / `<video>`. When `error` is true, render an inline fallback (icon + "No disponible") instead of the skeleton loader.

### Acceptance Criteria

1. `createSignedUrl()` returns error or null → `error` state is set → renders inline fallback (not skeleton).
2. `<img>` / `<video>` fires `onError` → `error` state is set → renders inline fallback (not skeleton).
3. `path` is empty string → renders inline fallback (not skeleton).
4. `createSignedUrl()` returns valid URL → renders normally (no change from current behavior).
5. Once `error` is set, it stays set for the current render cycle (no retry loop without explicit action).
6. TypeScript compiles with zero errors.

### Related Files

- `src/components/ui/SecureImage.tsx`
- `src/components/ui/SecureVideo.tsx`

---

## DKB-003 — Fix DataTable "No data" flash

### Description

`DataTable.tsx` renders an empty-state message ("No data") when data is falsy or empty. The problem: `InventoryTable` and `PurchasesTable` never pass `isLoading` to `DataTable`, so it defaults to `false`. When the parent hook is still fetching, the data is `undefined`, which gets coerced to falsy — and "No data" flashes briefly before the actual data arrives.

Fix: In `DataTable.tsx`, treat `data === undefined` as a loading state (show skeleton rows) even when `isLoading` is false. Only show "No data" when data is an empty array `[]`.

### Acceptance Criteria

1. `data` is `undefined` → skeleton rows render (same as `isLoading=true`), NOT "No data".
2. `data` is `[]` (empty array) → "No data" renders as before.
3. `data` has items → table rows render as before.
4. `isLoading=true` → skeleton rows render as before (no regression).
5. TypeScript compiles with zero errors.

### Related Files

- `src/components/ui/DataTable.tsx`

---

## DKB-004 — Reset InputModal form state on close

### Description

`InputModal.tsx` manages form state with `useState('')` initialized once on mount. When the user cancels (clicks "Cancelar" or clicks outside), the `onClose` callback fires but does NOT reset `value`. The stale text persists and reappears the next time the modal opens. This can cause incorrect actions — e.g., an admin types a suspension reason for User A, cancels, opens modal for User B, and sees User A's reason still in the field.

Fix: Add a `useEffect` that resets `value` to `''` when `isOpen` becomes false.

### Acceptance Criteria

1. Modal opens → value starts empty.
2. User types text → value updates (normal).
3. User clicks "Cancelar" → modal closes → value resets to `''`.
4. Modal reopens → value is empty (stale text is gone).
5. User types text and clicks "Confirmar" → `onConfirm` fires with value → value resets (existing behavior unchanged — the effect also covers this since `isOpen` becomes false).
6. TypeScript compiles with zero errors.

### Related Files

- `src/components/ui/InputModal.tsx`

---

## Non-Functional Requirements

| ID | Requirement | Check |
|----|-------------|-------|
| NFR-SEC-01 | No storage paths exposed in the DOM via `<img src>` | All images use `SecureImage` with signed URLs |
| NFR-PERF-01 | Error state does not trigger additional network requests | `error` is a static boolean — no retry, no re-fetch |
| NFR-UX-01 | Error fallback is visually distinguishable from a missing image | Inline broken-image icon + "No disponible" text |
| NFR-UX-02 | Modal form reset does not cause visible flicker | `useEffect` fires outside React's commit phase, no visual change when already `''` |
| NFR-MAIN-01 | DataTable's empty-state logic is centralized, not duplicated per consumer | Fix is inside `DataTable.tsx`, no changes needed in parent components |
