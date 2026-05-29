# Design — Phase 3: Component Breakdown & Responsive Layout

## Change
admin-dashboard-audit / Phase 3

## Part A — Component Architecture

### Component Tree

```
VerificationPage (orchestrator)
├── <header> inline (~15 lines)
│   ├── Title: "Verificación de Hardware"
│   ├── Subtitle: "Revisa la legitimidad de los productos..."
│   ├── Sync badge (animated green dot)
│   └── Queue count: "{n} En Revisión"
│
├── VerificationList
│   ├── SearchInput (controlled internally)
│   ├── CategoryFilter (ALL | GPU | CPU | RAM | Motherboard)
│   ├── ProductCard[] (scrollable list)
│   └── EmptyState / EmptyResults
│
├── VerificationDetail (conditional on selectedProduct)
│   ├── LockBanner (isLockedByOther)
│   ├── RejectionContext (rejection_reason)
│   ├── SellerPassport
│   │   ├── UserAvatar + Username + RankBadge + SellerID
│   │   ├── RankPopover (internal state)
│   │   ├── UserSafetyActions (existing component)
│   │   └── TrustMetrics (verified/rejected/sold/ratio)
│   ├── EvidenceViewer
│   │   ├── PhysicalProofImage (SecureImage)
│   │   ├── BenchmarkImage + ScoreBadge
│   │   └── PublicGallery (horizontal scroll)
│   ├── DescriptionSection
│   ├── SpecsGrid (ProductSpecsGrid — existing)
│   ├── InternalNotesSection
│   │   ├── NoteTextarea + SaveButton
│   │   └── NoteHistory[]
│   └── VerificationActions
│       ├── AdminNoteTextarea
│       ├── RejectButton (fire)
│       ├── ApproveButton (forest/lion)
│       └── ConfirmModal (internal state)
│
├── EmptyDetailState (conditional — no product selected)
└── ImageModal (global, at page level)
```

### Props Interfaces

```typescript
// VerificationList
interface VerificationListProps {
  products: PendingProduct[];
  selectedId: string | null;
  isLocking: boolean;
  onSelectProduct: (product: PendingProduct) => void;
}

// VerificationDetail
interface VerificationDetailProps {
  product: PendingProduct;
  lockStatus: LockStatus;
  isLocking: boolean;
  resolve: UseMutateAsyncFunction<...>; // from useMutation
  refetch: () => void;
  onImageClick: (url: string) => void;
  onVerdictComplete: () => void; // cleanup after approve/reject
}

// EvidenceViewer
interface EvidenceViewerProps {
  verificationData: Record<string, unknown> | null;
  images: string[];
  onImageClick: (url: string) => void;
}

// VerificationActions
interface VerificationActionsProps {
  product: PendingProduct;
  lockStatus: LockStatus;
  isLocking: boolean;
  resolve: UseMutateAsyncFunction<...>;
  onVerdictComplete: () => void;
}
```

### State Management

| State | Owner | Reason |
|---|---|---|
| `products`, `isLoading`, `isError`, `refetch` | `VerificationPage` (from `usePendingProducts`) | Shared across sub-components |
| `resolve` (mutation) | `VerificationPage` (from `usePendingProducts`) | Mutation lives with the query |
| `selectedId` | `VerificationPage` | Needed for lock cleanup on unmount |
| `lockStatus`, `isLocking` | `VerificationPage` (from `useProductLock`) | Lock is acquired/released by the page |
| `activeImage` | `VerificationPage` | `ImageModal` lives at page level |
| `searchTerm` | `VerificationList` (useState) | Pure UI state, no parent needs it |
| `activeCategory` | `VerificationList` (useState) | Pure UI state, no parent needs it |
| `filteredProducts` | `VerificationList` (useMemo) | Derived from products + local search/category |
| `showRankInfo` | `VerificationDetail` (useState) | Local popover toggle |
| `internalNote` | `VerificationDetail` (useState) | Internal notes textarea, local save |
| `adminNote` | `VerificationActions` (useState) | Admin review note, only used in verdict |
| `confirmData` | `VerificationActions` (useState) | Confirm modal state, only used in verdict flow |

### Data Flow

```
User clicks product card
  → VerificationList calls onSelectProduct(product)
    → VerificationPage calls acquireLock(product.id)
      → on success: setSelectedId(product.id)
        → VerificationDetail receives updated selectedProduct via prop
          → renders all detail sections
            → EvidenceViewer receives verificationData + images
            → VerificationActions receives resolve + lockStatus

User clicks Approve/Reject
  → VerificationActions sets confirmData (local)
    → ConfirmModal renders
      → User confirms → resolve.mutate({...})
        → onSuccess: onVerdictComplete() callback
          → VerificationPage: releaseLock(selectedId) + setSelectedId(null)
```

### File Changes

**Create** (under `apps/admin-web/src/components/features/verify/`):
- `VerificationList.tsx`
- `VerificationDetail.tsx`
- `EvidenceViewer.tsx`
- `VerificationActions.tsx`

**Modify**:
- `apps/admin-web/src/pages/VerificationPage.tsx` — strip to orchestrator, under 200 lines
- `apps/admin-web/src/components/layout/Layout.tsx` — responsive sidebar
- `apps/admin-web/src/pages/DisputeDetailPage.tsx` — fix `left-64` → `left-0 lg:left-64`

**No change**:
- `ImageModal.tsx` — stays at page level, unchanged
- `ConfirmModal.tsx` — stays generic, reused by VerificationActions
- `ProductSpecsGrid.tsx` — stays as-is, imported by VerificationDetail

---

## Part B — Responsive Layout

### Strategy

Use React state + Tailwind responsive classes. No CSS-in-JS, no external libraries. The sidebar toggles via a boolean `isSidebarOpen` state in `Layout.tsx`.

### Implementation

```tsx
// Layout.tsx
const [isSidebarOpen, setIsSidebarOpen] = useState(false);

// Container: sidebar + main
<div className="flex h-screen bg-night text-platinum">
  
  {/* BACKDROP (mobile only) */}
  {isSidebarOpen && (
    <div
      className="fixed inset-0 bg-black/50 z-40 lg:hidden"
      onClick={() => setIsSidebarOpen(false)}
    />
  )}

  {/* SIDEBAR */}
  <aside className={clsx(
    "fixed lg:static inset-y-0 left-0 z-50 w-64 bg-state-gray border-r border-white/5 flex flex-col",
    "transition-transform duration-300 ease-in-out",
    isSidebarOpen ? "translate-x-0" : "-translate-x-full",
    "lg:translate-x-0" // always visible on desktop
  )}>
    ...existing sidebar content...
  </aside>

  {/* MAIN CONTENT */}
  <main className="flex-1 overflow-y-auto p-8 ml-0 lg:ml-64">
    {/* HAMBURGER (mobile only) */}
    <button
      className="lg:hidden mb-4 p-2 hover:bg-white/5 rounded-lg"
      onClick={() => setIsSidebarOpen(!isSidebarOpen)}
    >
      <Menu size={24} />
    </button>
    
    <Outlet />
  </main>
</div>
```

### Key CSS Details

- **Sidebar**: `fixed` on mobile (overlay), `static` on desktop (`lg:static`). Uses `translate-x` for slide animation with `transition-transform duration-300 ease-in-out`.
- **Backdrop**: `fixed inset-0 z-40 bg-black/50`, hidden on `lg:`.
- **Main content**: `ml-0 lg:ml-64` — full width on mobile, offset by sidebar width on desktop.
- **Hamburger**: `lg:hidden` — only visible below 1024px.
- **Auto-close**: `onClick` on each nav-link calls `setIsSidebarOpen(false)`.

### DisputeDetailPage Fix

```tsx
// Before:
className="fixed bottom-0 left-64 right-0 ..."

// After:
className="fixed bottom-0 left-0 lg:left-64 right-0 ..."
```

This single-character change ensures the bottom bar respects the sidebar overlay on mobile (`left-0`) while maintaining the desktop offset (`lg:left-64`).

### Tradeoffs

| Approach | Chosen? | Why |
|---|---|---|
| CSS-only `peer`/`hidden` + checkbox hack | ❌ | Need React state for backdrop click and auto-close on nav |
| `framer-motion` AnimatePresence | ❌ | Unnecessary bundle weight for a simple translate-x animation |
| Separate `Sidebar.tsx` component | 🤷 | Optional — Layout is only 93 lines. Extract ONLY if `isSidebarOpen` + hamburger logic makes Layout exceed ~120 lines. For now, keep inline |
| CSS `container` queries | ❌ | Layout structure is viewport-relative, not container-relative. Standard breakpoints suffice |

### Breakpoints

| Range | Sidebar | Main | Hamburger |
|---|---|---|---|
| < 1024px | Overlay (hidden by default, slides in) | Full width (`ml-0`) | Visible |
| >= 1024px | Static (`w-64`, always visible) | Offset (`ml-64`) | Hidden |
