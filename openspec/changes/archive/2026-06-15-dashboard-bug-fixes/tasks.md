# Tasks: Dashboard Bug Fixes

**Change**: `dashboard-bug-fixes`
**Date**: 2026-05-29
**Forecast**: ~40 net lines, 7 files

---

## Task Index

| ID | Title | Spec | Effort | Deps | Files |
|----|-------|------|--------|------|-------|
| DKB-TASK-001 | Add error state to SecureImage + SecureVideo | DKB-002 | M | — | `SecureImage.tsx`, `SecureVideo.tsx` |
| DKB-TASK-002 | Replace raw `<img>` with SecureImage in 3 consumers | DKB-001 | S | DKB-TASK-001 | `InventoryTable.tsx`, `PurchasesTable.tsx`, `EvidenceViewer.tsx` |
| DKB-TASK-003 | Fix DataTable "No data" flash for undefined data | DKB-003 | XS | — | `DataTable.tsx` |
| DKB-TASK-004 | Reset InputModal value when modal closes | DKB-004 | XS | — | `InputModal.tsx` |

---

## DKB-TASK-001 — Add error state to SecureImage and SecureVideo

- **Spec**: DKB-002
- **Effort**: M (~20 lines each component)
- **Deps**: None

### Description

Both `SecureImage` and `SecureVideo` show an infinite skeleton (`animate-pulse bg-white/5`) when the signed URL fetch fails, the image/video element errors, or the path is empty. Add an `error: boolean` state that gets set in all three failure cases, then render an inline fallback (broken-image icon + "No disponible") instead of the skeleton.

### Steps

**SecureImage.tsx** — 4 targeted edits:

1. **Add error state** after line 22 (`const [url, setUrl] = useState<string | null>(null);`):
   ```tsx
   const [url, setUrl] = useState<string | null>(null);
   const [error, setError] = useState(false);
   ```

2. **Handle empty path** — change line 25 from:
   ```tsx
   if (!path) return;
   ```
   to:
   ```tsx
   if (!path) { setError(true); return; }
   ```

3. **Handle createSignedUrl failure** — after line 31, change:
   ```tsx
   if (data) setUrl(data.signedUrl);
   ```
   to:
   ```tsx
   if (data) {
     setUrl(data.signedUrl);
   } else {
     setError(true);
   }
   ```

4. **Handle img onError** — add `onError` to the `<img>` at line 40:
   ```tsx
   <img src={url} alt={alt} className={className} onError={() => setError(true)} />
   ```

5. **Update skeleton return** — change line 36 from:
   ```tsx
   if (!url) return <div className={`animate-pulse bg-white/5 ${className}`} />;
   ```
   to:
   ```tsx
   if (error) {
     return (
       <div className={`flex items-center justify-center bg-white/5 ${className}`}>
         <span className="text-blue-light text-xs">No disponible</span>
       </div>
     );
   }
   if (!url) return <div className={`animate-pulse bg-white/5 ${className}`} />;
   ```

**SecureVideo.tsx** — apply identical pattern (same 5 edits):

1. Add `const [error, setError] = useState(false);` after line 16.
2. Change line 19 `if (!path) return;` → `if (!path) { setError(true); return; }`.
3. Change line 26 `if (data) setUrl(data.signedUrl);` → add `else { setError(true); }`.
4. Add `onError={() => setError(true)}` to `<video>` at line 34.
5. Replace the skeleton return at line 31 with the same error/skeleton conditional.

### Acceptance Criteria

- [x] `createSignedUrl()` returns error or null → inline fallback renders (not skeleton)
- [x] `<img>` / `<video>` fires `onError` → inline fallback renders (not skeleton)
- [x] `path` is empty string → inline fallback renders (not skeleton)
- [x] Valid URL returned → normal image/video renders (no regression)
- [x] `error` is sticky per mount — no auto-retry loop
- [x] TypeScript compiles with zero errors

---

## DKB-TASK-002 — Replace raw `<img>` with SecureImage in 3 consumers

- **Spec**: DKB-001
- **Effort**: S (~15 lines total)
- **Deps**: DKB-TASK-001 (SecureImage must handle errors before being used in tables)

### Description

After DKB-TASK-001 ensures `SecureImage` handles errors gracefully, swap the raw `<img>` tags in `InventoryTable`, `PurchasesTable`, and `EvidenceViewer` gallery for `<SecureImage>`. Pass the same `bucket="verification"` (default) for product photos. Preserve existing `onClick` zoom behavior in `EvidenceViewer`.

### Steps

**InventoryTable.tsx** — replace lines 22-26:

Change:
```tsx
<img
  src={row.original.images?.[0]}
  className="w-10 h-10 rounded-lg object-cover bg-night border border-white/5"
  alt={row.original.name}
/>
```
To:
```tsx
<SecureImage
  path={row.original.images?.[0] ?? ''}
  alt={row.original.name}
  className="w-10 h-10 rounded-lg object-cover bg-night border border-white/5"
/>
```

Also add import at top:
```tsx
import { SecureImage } from '../../ui/SecureImage';
```

**PurchasesTable.tsx** — replace lines 21-25:

Change:
```tsx
<img
  src={row.original.product?.images?.[0]}
  className="w-8 h-8 rounded bg-night"
  alt=""
/>
```
To:
```tsx
<SecureImage
  path={row.original.product?.images?.[0] ?? ''}
  alt=""
  className="w-8 h-8 rounded bg-night"
/>
```

Also add import at top:
```tsx
import { SecureImage } from '../../ui/SecureImage';
```

**EvidenceViewer.tsx** — replace lines 74-78 (gallery `<img>` loop only):

Change the raw `<img>` inside the `images?.map`:
```tsx
<img
  src={img}
  className="w-full h-full object-cover"
  alt={`Venta ${index}`}
/>
```
To:
```tsx
<SecureImage
  path={img}
  alt={`Venta ${index}`}
  className="w-full h-full object-cover"
/>
```

Keep the outer `<div>` wrapper and zoom `<button>` intact at lines 70-73 and 79-85. The `onClick` on the zoom button still calls `onImageClick(img)` (raw path) — this is preserved from the original behavior.

Also add import if not already present (line 2 already has `SecureImage` imported for proof_physical and proof_performance).

### Acceptance Criteria

- [x] InventoryTable product thumbnails render via signed URL (not broken image icon)
- [x] PurchasesTable product thumbnails render via signed URL (not broken image icon)
- [x] EvidenceViewer gallery images render via signed URL with zoom preserved
- [x] `bucket="verification"` used (default prop, no explicit prop needed)
- [x] `images?.[0] ?? ''` prevents undefined path being passed
- [x] TypeScript compiles with zero errors
- [x] No visual regression — thumbnail sizes unchanged (`w-10 h-10` / `w-8 h-8`)

---

## DKB-TASK-003 — Fix DataTable "No data" flash for undefined data

- **Spec**: DKB-003
- **Effort**: XS (~2 lines)
- **Deps**: None

### Description

`DataTable` shows skeleton rows when `isLoading=true`. But `InventoryTable` and `PurchasesTable` don't pass `isLoading`, so when data is `undefined` (query in flight), the ternary at line 189 falls through to "No data" before real data arrives. Fix: treat `data === undefined` as a loading state.

### Steps

**DataTable.tsx** — restructure the ternary at lines 185-217:

Change line 189 from:
```tsx
) : data && data.length > 0 ? (
```
To:
```tsx
) : data === undefined ? (
  Array.from({ length: skeletonRowCount }, (_, i) => (
    <SkeletonRow key={`skeleton-${i}`} columns={columnCount} />
  ))
) : data.length > 0 ? (
```

This inserts the skeleton branch between the `isLoading` branch and the data/empty branches. The empty array (`[]`) case still falls through to "No data" as before.

### Acceptance Criteria

- [x] `data` is `undefined` → skeleton rows render (not "No data")
- [x] `data` is `[]` → "No data" renders (no regression)
- [x] `data` has items → table rows render (no regression)
- [x] `isLoading=true` → skeleton rows render (no regression)
- [x] TypeScript compiles with zero errors

---

## DKB-TASK-004 — Reset InputModal value when modal closes

- **Spec**: DKB-004
- **Effort**: XS (~3 lines)
- **Deps**: None

### Description

`InputModal` has one `useState('')` initialized on mount. When the user cancels, the stale text persists and reappears on the next open. Add a `useEffect` that resets `value` to `''` whenever `isOpen` becomes `false`.

### Steps

**InputModal.tsx** — add `useEffect` after line 24 (`const [value, setValue] = useState('');`):

```tsx
const [value, setValue] = useState('');

useEffect(() => {
  if (!isOpen) setValue('');
}, [isOpen]);
```

The existing `setValue('')` in the confirm handler (line 56) can stay — it's idempotent and provides explicitness. The `useEffect` covers all close paths: Cancel button, backdrop click, `onClose` callback.

### Acceptance Criteria

- [x] Modal opens → value starts empty
- [x] User types text → value updates (normal)
- [x] User clicks "Cancelar" → modal closes → value resets to `''`
- [x] Modal reopens → value is empty (stale text gone)
- [x] User clicks "Confirmar" → `onConfirm` fires → value resets (existing behavior)
- [x] TypeScript compiles with zero errors

---

## Dependency Graph

```
DKB-TASK-001 (error state SecureImage+SecureVideo)
    │
    └─→ DKB-TASK-002 (swap raw <img> → SecureImage in tables)
             │
             ├─→ InventoryTable.tsx
             ├─→ PurchasesTable.tsx
             └─→ EvidenceViewer.tsx

DKB-TASK-003 (DataTable undefined fix) ── independent
DKB-TASK-004 (InputModal reset)        ── independent
```

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~40 net |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Delivery strategy | single-pr |
| Chain strategy | N/A |
| Decision needed before apply | No |

All tasks are small and self-contained. A single PR with well-labeled work-unit commits is the right delivery vehicle.