# Design: Dashboard Bug Fixes

**Change**: `dashboard-bug-fixes`
**Date**: 2026-05-29

## Architecture Overview

Four tightly-scoped bug fixes across 7 files in the admin dashboard. No new dependencies, no backend changes, no new components. All fixes are additive or replace existing inline code with existing shared components (`SecureImage`). The approach is surgical: add error-state booleans to two media components, swap raw `<img>` for `<SecureImage>` in three consumers, adjust one ternary in `DataTable`, and add one `useEffect` to `InputModal`.

## Detailed Design

### DKB-001 — Replace raw `<img>` with SecureImage

**Files**: `InventoryTable.tsx`, `PurchasesTable.tsx`, `EvidenceViewer.tsx`
**Pattern**: Use the existing `SecureImage` component (already imports `supabase` and calls `createSignedUrl`) instead of raw `<img src={storagePath}>`.

**Implementation**:
- `InventoryTable.tsx` — replace lines 22-26 (`<img src={row.original.images?.[0]}>`) with `<SecureImage path={row.original.images?.[0] ?? ''} alt={row.original.name} className="w-10 h-10 rounded-lg object-cover bg-night border border-white/5" />`. Bucket defaults to `'verification'` in `SecureImage`, so no `bucket` prop needed.
- `PurchasesTable.tsx` — replace lines 21-25 (`<img src={row.original.product?.images?.[0]}>`) with `<SecureImage path={row.original.product?.images?.[0] ?? ''} alt="" className="w-8 h-8 rounded bg-night" />`.
- `EvidenceViewer.tsx` — replace the raw `<img>` loop (lines 74-78) with `<SecureImage path={img} className="w-full h-full object-cover" alt={`Venta ${index}`} onClick={(url) => onImageClick(url)} />`. The outer `<div>` and zoom `<button>` wrapper stays intact.

**Edge Cases**:
- `images?.[0]` can be `undefined` — pass `?? ''` to `SecureImage`; DKB-002 handles empty string gracefully.
- `EvidenceViewer` gallery `onClick` must still call `onImageClick(img)` (the raw path, not the signed URL), because the parent zoom/lightbox may do its own URL resolution. Note: if the zoom overlay should use the signed URL, we can pass `url` from `SecureImage`'s `onClick` callback instead.

### DKB-002 — Add error state to SecureImage and SecureVideo

**Files**: `SecureImage.tsx`, `SecureVideo.tsx`
**Pattern**: Add `error: boolean` to state. Set it on `createSignedUrl` failure, media `onError`, and empty `path`. Render a small inline fallback instead of the skeleton when `error` is true.

**Implementation**:
- `SecureImage.tsx`:
  1. Add `const [error, setError] = useState(false);`.
  2. In `useEffect`, before returning early for `!path`, set `setError(true)`.
  3. In `getSignedUrl`, if `!data` (error or null response), call `setError(true)`.
  4. Add `onError={() => setError(true)}` to the `<img>` element.
  5. In render, if `error`, return `<div className={className}><ImageOff className="..." /></div>` (or inline text "No disponible"). If `!url && !error`, keep existing skeleton.
- `SecureVideo.tsx`: identical pattern — add `error` state, set on `!path`, `!data`, and `<video onError>`.

**Edge Cases**:
- `error` is sticky per mount; no auto-retry to avoid request loops.
- CORS is not a concern because signed URLs are same-origin to the Supabase project.

### DKB-003 — Fix DataTable "No data" flash

**Files**: `DataTable.tsx`
**Pattern**: Change the render branch condition so `data === undefined` renders skeleton rows, same as `isLoading === true`.

**Implementation**:
- Line 189 currently reads: `data && data.length > 0 ?`.
- Restructure the ternary at line 185-217 to:
  ```tsx
  {isLoading || data === undefined ? (
    <SkeletonRow ... />
  ) : data.length > 0 ? (
    <table rows ... />
  ) : (
    <tr><td colSpan={...}>{emptyMessage}</td></tr>
  )}
  ```
- `useReactTable` already receives `data: data ?? []`, so the table instance itself stays safe.

**Edge Cases**:
- `data === null` is not expected by the type signature (`TData[]`), but if it occurs it will fall through to the "No data" branch. Acceptable — the fix targets `undefined` from React Query / hooks.

### DKB-004 — Reset InputModal form state on close

**Files**: `InputModal.tsx`
**Pattern**: Add a `useEffect` that resets `value` when `isOpen` transitions to `false`.

**Implementation**:
- After the `useState` declaration (line 24), add:
  ```tsx
  useEffect(() => {
    if (!isOpen) setValue('');
  }, [isOpen]);
  ```
- Keep the existing `setValue('')` inside the confirm handler (line 56) for explicitness — idempotent and safe.

**Edge Cases**:
- On initial mount `isOpen` is usually `false`; resetting `''` to `''` is a no-op.
- If `onConfirm` is async and the modal stays open during loading, the effect does not fire until `isOpen` actually becomes `false`.

## Design Decisions

| Decision | Option A | Option B | Chosen | Rationale |
|----------|----------|----------|--------|-----------|
| Error fallback style | Inline broken-image icon + text | Dedicated `MediaError` component | Inline | Avoids new component boilerhead for ~4 lines of JSX; NFR says "inline fallback" |
| SecureImage `bucket` prop | Explicit `bucket="verification"` per call | Rely on default prop | Default prop | Less churn; default is already `'verification'` which matches product-photo buckets |
| DataTable undefined check | `data === undefined` branch | Change `DataTableProps.data` to optional `TData[] \| undefined` | `data === undefined` branch | Keeps type change minimal; the prop is already optional in practice because parents don't pass `isLoading` |
| InputModal reset timing | `useEffect` on `isOpen` | Reset in `onClose` wrapper passed by parent | `useEffect` | Guarantees reset on any close path (Cancel, backdrop click, unmount) without touching every consumer |

## Interaction Map

```
InventoryTable ──→ SecureImage (product thumbnail)
                 └─→ DataTable

PurchasesTable ──→ SecureImage (product thumbnail)
                └─→ DataTable

EvidenceViewer ──→ SecureImage (proof_physical, proof_performance, gallery)

DataTable ──→ SkeletonRow (internal)

InputModal ──→ (consumed by various feature pages)

SecureImage / SecureVideo ──→ supabase.storage.createSignedUrl
```

**Call graph summary**:
- `SecureImage` is a leaf component (no children, calls `supabase`).
- `SecureVideo` is a leaf component (no children, calls `supabase`).
- `DataTable` is a generic presentational component; `InventoryTable` and `PurchasesTable` are its only affected consumers.
- `EvidenceViewer` is a feature component that owns `SecureImage` instances.
- `InputModal` is a standalone reusable modal; no direct interaction with the other changed files.
