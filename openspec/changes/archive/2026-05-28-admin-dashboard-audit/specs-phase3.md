# Specs — Phase 3: Component Breakdown & Responsive Layout

## Change
admin-dashboard-audit / Phase 3

## Requirements

---

### PH3-REQ-001: Extract VerificationList component

**Title**: Extract VerificationList from VerificationPage

**Description**: Extract the left-column product list (search input, category filter chips, scrollable product card list, empty states) from `VerificationPage.tsx` into a self-contained `VerificationList` component under `components/features/verify/`. The component manages its own search term and active category state internally — it receives the full `products` array and returns the selected product ID upward.

**Acceptance Criteria**:
- AC1: `VerificationList` renders a search input, category filter bar (ALL/GPU/CPU/RAM/Motherboard), and scrollable product card list
- AC2: Tapping a product card calls `onSelectProduct(productId)` and highlights the selected card
- AC3: Empty search results show "No se encontraron resultados" + "Limpiar filtros" button
- AC4: Zero products state shows "No hay productos por verificar. ¡Buen trabajo!"
- AC5: Search and category filtering operate entirely within the component — no filtering logic leaks to the parent
- AC6: Category filter bar is horizontally scrollable on narrow viewports (`overflow-x-auto scrollbar-hide`)

---

### PH3-REQ-002: Extract VerificationDetail component

**Title**: Extract VerificationDetail from VerificationPage

**Description**: Extract the right-column detail panel (lock banner, rejection reason context, seller passport with rank popover, seller safety actions, trust metrics, product description, specs grid, internal notes section) from `VerificationPage.tsx` into a `VerificationDetail` component under `components/features/verify/`. This component composes `EvidenceViewer` and `VerificationActions` internally.

**Acceptance Criteria**:
- AC1: `VerificationDetail` renders the complete detail panel when a product is selected: lock banner, rejection context, seller passport (avatar + username + rank + seller ID + safety actions + trust metrics)
- AC2: Rank popover opens/closes via internal state (`showRankInfo`), triggered by clicking the rank badge
- AC3: Internal notes textarea + save button + notes history renders and functions
- AC4: Product description and `ProductSpecsGrid` render with correct data
- AC5: When no product is selected, renders null (the empty state stays in the parent `VerificationPage`)

---

### PH3-REQ-003: Extract EvidenceViewer component

**Title**: Extract EvidenceViewer from VerificationPage

**Description**: Extract the evidence display section — physical proof image, performance benchmark image + score overlay, and public sale gallery — into a standalone `EvidenceViewer` component under `components/features/verify/`. This component is purely presentational: it receives `verificationData` and `images` props and fires `onImageClick(url)` when any image is clicked.

**Acceptance Criteria**:
- AC1: `EvidenceViewer` renders a 2-column grid (physical proof + benchmark) showing `SecureImage` components
- AC2: Benchmark score badge overlays the bottom-right of the benchmark image when `benchmark_score` is present
- AC3: Public sale gallery renders as a horizontal scrollable row of thumbnails with hover zoom overlay
- AC4: Clicking any image calls `onImageClick(url)` — the `ImageModal` stays at page level
- AC5: Missing images show placeholder without breaking layout

---

### PH3-REQ-004: Extract VerificationActions component

**Title**: Extract VerificationActions from VerificationPage

**Description**: Extract the admin note textarea, approve/reject buttons, and confirmation modal into a `VerificationActions` component under `components/features/verify/`. This component manages its own `confirmData` and `adminNote` state internally. It receives the resolve mutation, lock status, and product data as props.

**Acceptance Criteria**:
- AC1: Admin note textarea renders with placeholder text; value is managed internally
- AC2: Reject button renders with fire/red styling, opens ConfirmModal with `type="danger"`
- AC3: Approve button renders with forest/green styling (or lion/gold if adminNote is present), opens ConfirmModal with `type="success"`
- AC4: Buttons are disabled when `isLockedByOther`, `isLocking`, or `resolve.isPending`
- AC5: Confirm modal displays correct title, description (including adminNote), and confirm label based on verdict
- AC6: On successful confirm, calls `resolve.mutate()` then invokes `onVerdictComplete()` callback for parent cleanup
- AC7: Loading spinner shows on approve button text while `resolve.isPending`

---

### PH3-REQ-005: Reduce VerificationPage to orchestrator

**Title**: Refactor VerificationPage to orchestrator pattern

**Description**: After extracting all sub-components, strip `VerificationPage.tsx` to an orchestrator that only owns: query/lock hooks, top-level state (`selectedId`, `activeImage`), and renders the header + sub-components. The page must be under 200 lines.

**Acceptance Criteria**:
- AC1: `VerificationPage` imports and renders `VerificationList`, `VerificationDetail`, `EvidenceViewer`, `VerificationActions`, `ImageModal`
- AC2: All data flow passes through props — no sub-component imports its own hooks except `usePendingProducts` and `useProductLock` which remain at the page level
- AC3: `selectedId` is the only page-level selection state; `releaseLock` is called on page unmount via `useEffect` cleanup
- AC4: `ImageModal` remains at page level, receives `activeImage` and `onClose`
- AC5: Page is under 200 lines (after extraction)
- AC6: All existing behavior is preserved — search, filter, select product, view detail, approve, reject, lock, internal notes, rank info, evidence viewing

---

### PH3-REQ-006: Make Layout sidebar responsive

**Title**: Add collapsible sidebar with overlay on mobile

**Description**: Make the Layout sidebar collapsible on viewports below 1024px. On desktop (>=1024px), the sidebar renders at full `w-64` as it does today. On mobile/tablet (<1024px), the sidebar is hidden by default and slides in as an overlay with a backdrop when toggled via a hamburger button.

**Acceptance Criteria**:
- AC1: On screens >=1024px (`lg:`), sidebar renders at `w-64` fixed — identical to current behavior
- AC2: On screens <1024px, sidebar is hidden by default (`-translate-x-full`)
- AC3: Hamburger button (Menu icon from lucide-react) appears in the top-left of the main content area on mobile
- AC4: Clicking hamburger toggles `isSidebarOpen` state — sidebar slides in with `translate-x-0` + `transition-transform`
- AC5: A semi-transparent backdrop overlay covers the main content when sidebar is open on mobile
- AC6: Clicking the backdrop closes the sidebar
- AC7: Sidebar closes automatically when a navigation link is clicked on mobile
- AC8: Main content area is full width on mobile (no `ml-64`), `ml-64` only on `lg:`

---

### PH3-REQ-007: Fix fixed-bottom-bar responsive positioning

**Title**: Update DisputeDetailPage fixed bottom bar for responsive layout

**Description**: The fixed bottom action bar in `DisputeDetailPage.tsx` uses `left-64` to offset for the sidebar. After the responsive layout change, this must be conditional — `left-64` on desktop, `left-0` on mobile/tablet.

**Acceptance Criteria**:
- AC1: Fixed bottom bar renders at `left-64` on screens >=1024px (desktop sidebar visible)
- AC2: Fixed bottom bar renders at `left-0` on screens <1024px (sidebar hidden/overlay)
- AC3: Only the `className` on the fixed bar div changes — no structural or behavioral changes to the page

---

## Scenarios

### S1: Loading state for detail panel
When the page is loading (isLoading = true), a centered spinner with "Sincronizando con Selene DB..." is shown. The entire page renders the loading state — no split loading.

### S2: Empty search results
User types a query that matches no products. `VerificationList` shows "No se encontraron resultados" with a "Limpiar filtros" link that resets search and category.

### S3: Image modal open/close
User clicks any evidence image. `onImageClick(url)` fires from `EvidenceViewer` → `VerificationPage` sets `activeImage` → `ImageModal` renders fullscreen. User clicks X or backdrop to close.

### S4: Sidebar toggle on mobile
User on a 768px viewport sees a hamburger icon. Clicking it slides the sidebar in from the left with backdrop overlay. Clicking a nav link or the backdrop closes it.

### S5: Lock denied when selecting product
User clicks a product card that another admin has locked. `VerificationList` shows the card as inactive (disabled). The product is not selected. A toast warning appears: "Acceso denegado: Producto en revisión por {name}".

### S6: Error state
When `isError` is true, the entire `VerificationPage` renders `ErrorState` with a retry button — no sub-components are visible. This behavior is unchanged from the current page.
