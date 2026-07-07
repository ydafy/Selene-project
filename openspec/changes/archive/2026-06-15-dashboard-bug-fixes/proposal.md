# Proposal: Dashboard Bug Fixes

**Change**: `dashboard-bug-fixes`
**Status**: proposed
**Date**: 2026-05-29
**Author**: SDD explore phase

## Intent

Fix 4 known bugs in the Selene admin dashboard that degrade reliability and UX: broken images from raw `<img>` with storage paths, infinite skeleton spinners on error states, "No data" flash when data is undefined, and stale form state in InputModal on reopen.

## Scope

### In Scope
- DKB-001: Replace raw `<img>` with `SecureImage` in InventoryTable, PurchasesTable, and EvidenceViewer gallery
- DKB-002: Add error state + `onError` handlers to SecureImage and SecureVideo (stop infinite skeleton on failure)
- DKB-003: Fix DataTable "No data" flash when `data` is `undefined` and `isLoading` is not passed
- DKB-004: Reset InputModal `value` when modal closes (Cancel + unmount)

### Out of Scope
- Retry logic for failed signed URLs
- New lightweight error/broken-image component (will use inline fallback)
- DataTable column visibility or CSV export
- i18n / localization of UI strings
- Any backend, Edge Function, or database changes

## Capabilities

### New Capabilities
None — all changes are bug fixes within existing components.

### Modified Capabilities
- `secure-media`: error state handling in SecureImage and SecureVideo components (spec-level: MUST show fallback instead of infinite skeleton on fetch/render failure)
- `data-table`: loading state logic for undefined data (spec-level: MUST treat undefined data as loading, not empty)
- `input-modal`: form state lifecycle on close (spec-level: MUST reset value on close, not just on confirm)

## Approach

**DKB-001 — Broken Images**: Replace `<img src={storagePath}>` with `<SecureImage path={storagePath}>` in 3 files. `SecureImage` already handles signed URL generation. In `InventoryTable.tsx` and `PurchasesTable.tsx`, swap `<img>` for `<SecureImage>` with bucket prop and appropriate `className`. In `EvidenceViewer.tsx` gallery, replace the raw `<img>` loop with `<SecureImage>` components, passing `onClick` for zoom.

**DKB-002 — Infinite Skeleton**: Add an `error` state (`boolean`) to `SecureImage` and `SecureVideo`. Set it when `createSignedUrl` returns no data, or when `<img>`/`<video>` fires `onError`. In the render, if `error` is true, show a small inline fallback (broken-image icon + "Failed to load"). This prevents the `animate-pulse` skeleton from spinning forever. ~10 lines each component.

**DKB-003 — DataTable Flash**: Change the render condition in `DataTable.tsx` line 189 from `data && data.length > 0` to handle `undefined` data as a loading state. When `data` is `undefined`, show skeleton rows (same as `isLoading`). This prevents the brief "No data" flash while a query is still in flight. ~2 lines.

**DKB-004 — InputModal Stale State**: Add a `useEffect` that resets `value` to `''` when `isOpen` changes to `false`. This ensures Cancel + unmount both clear the form. Also remove the `setValue('')` from the confirm handler since the effect covers it (or keep both for explicitness). ~3 lines.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/components/ui/SecureImage.tsx` | Modified | Add error state + onError handler + fallback UI |
| `src/components/ui/SecureVideo.tsx` | Modified | Add error state + onError handler + fallback UI |
| `src/components/ui/DataTable.tsx` | Modified | Treat undefined data as loading state |
| `src/components/ui/InputModal.tsx` | Modified | Reset value on close via useEffect |
| `src/components/features/users/InventoryTable.tsx` | Modified | Replace `<img>` with `<SecureImage>` |
| `src/components/features/users/PurchasesTable.tsx` | Modified | Replace `<img>` with `<SecureImage>` |
| `src/components/features/verify/EvidenceViewer.tsx` | Modified | Replace gallery `<img>` with `<SecureImage>` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SecureImage bucket prop wrong for product images | Low | Product images use `verification` bucket by default (SecureImage default); verify bucket name per usage |
| onError on `<img>` fires for network errors only, not CORS | Low | Signed URLs are same-origin; CORS not an issue. Network errors + 404s are the primary cases |
| DataTable change treats truly empty data as loading briefly | Low | Only affects `undefined` data; empty arrays (`[]`) still show "No data" correctly |
| InputModal useEffect fires on initial mount (isOpen=false) | Low | Value initializes to `''`; resetting to `''` is idempotent and has no visible effect |

## Rollback Plan

All changes are client-side component modifications — no DB migrations, no API contract changes. Revert each file individually via git. No deployment dependencies.

## Dependencies

None — all changes are self-contained frontend fixes.

## Success Criteria

- [ ] Product images in InventoryTable and PurchasesTable render via signed URLs (no broken `<img>`)
- [ ] EvidenceViewer gallery images render via signed URLs
- [ ] SecureImage shows a fallback (not infinite skeleton) when signed URL fails or `<img>` errors
- [ ] SecureVideo shows a fallback (not infinite skeleton) when signed URL fails or `<video>` errors
- [ ] DataTable shows skeleton (not "No data") when `data` is `undefined`
- [ ] DataTable still shows "No data" when `data` is `[]` (empty array)
- [ ] InputModal clears form value on Cancel close
- [ ] InputModal clears form value on unmount/close outside

## Forecast

- **Estimated net lines**: ~40
- **Files touched**: 7
- **Well under 400-line budget**: Yes
- **Chained PRs needed**: No