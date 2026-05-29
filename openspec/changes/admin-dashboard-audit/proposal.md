# Proposal: Admin Dashboard Audit & Refactor

## Intent

Comprehensive audit and refactor of the Selene admin web dashboard (`apps/admin-web/src/`). Six ordered phases eliminate technical debt (pervasive `any` types, dead code, monolithic components), add missing infrastructure (error boundaries, virtualization, responsive layout), and bring the KPI dashboard from raw numbers to actionable metrics. The result is a production-grade admin panel at the same design quality standard as the rest of the platform.

## Scope

### In Scope
1. **Quick Cleanup** — Remove dead code (`ReturnLabelModal`, `UserPassport`, `App.css`), fix `index.html` title, fix `scrollbar-hide` utility
2. **Type Safety** — Eliminate all `any`/`eslint-disable @typescript-eslint/no-explicit-any` across 14+ files, migrate from hand-rolled HTML tables to `@tanstack/react-table` v8, add proper generics
3. **Component Breakdown** — Split `VerificationPage` (710 lines, 4 concerns) into focused sub-components, make `Layout` sidebar responsive (collapsible/overlay on mobile)
4. **KPI Dashboard Enhancements** — Add trends (% change vs prior period), targets, sparkline charts, strategic metrics (MRR, churn, LTV/CAC), fix `ActivityFeed` error state
5. **Data Fetching & Resilience** — Optimize `useUserDetail` (16 parallel queries → aggregate), add React error boundaries, loading skeletons (replace spinners), virtualization for long lists
6. **Aesthetic Polish** — Micro-interactions, transitions, responsive fine-tuning

### Out of Scope
- New pages or features not already existing
- Backend/Edge Function changes
- Mobile app (frontend) changes
- Adding E2E tests or Playwright test suite
- Stripe or payment integration changes
- Database schema or RLS changes

## Current State

**Health Score**: 6.5/10. The dashboard has a cohesive dark-theme aesthetic but is eroded by:

| Issue | Severity | Files Affected |
|-------|----------|----------------|
| `any` types with eslint-disable | High | 14+ files |
| `@tanstack/react-table` installed, zero usage | High | All table code |
| `VerificationPage` monolithic (710 lines) | High | 1 file, 4 concerns |
| No error boundaries | High | Entire dashboard |
| Layout sidebar `w-64` fixed, not responsive | High | `Layout.tsx` |
| KPIs lack trends/targets/context | Medium | `DashboardHome.tsx` |
| `useUserDetail` fires 16 parallel queries | Medium | 1 hook |
| Dead code: `ReturnLabelModal`, `UserPassport`, `App.css` | Low | 3 files |
| Console.log debugging in production hooks | Low | 2 hooks |
| No loading skeletons (spinners only) | Low | All pages |
| No virtualization for long lists | Low | Tables, lists |

## Target State

- **Type safety**: Zero `any` types across the admin-web workspace. `tsc -b` passes clean with strict mode.
- **Tables**: All data lists use `@tanstack/react-table` with proper column definitions, sorting, filtering, and pagination — no raw HTML `<table>` elements.
- **Components**: `VerificationPage` split into 4 focused components. Layout sidebar collapses on mobile screens.
- **Dashboard**: Each KPI shows value + % trend + target indicator + sparkline (7-day). Strategic metrics added. `ActivityFeed` shows error + retry.
- **Resilience**: Error boundaries wrap every page. Loading skeletons render on every async state. Long lists virtualized.
- **Code quality**: No dead code, no console.log in production, proper Tailwind v4 utilities, no eslint-disable comments.

## Phases

### Phase 1 — Quick Cleanup

| | |
|---|---|
| **Goal** | Clear dead code and easy fixes — zero-risk improvements first |
| **Files** | `apps/admin-web/index.html`, `apps/admin-web/src/App.css`, all imports referencing removed components, `apps/admin-web/tailwind.config.ts` (or `index.css` if `scrollbar-hide` is a custom utility) |
| **Approach** | Delete `ReturnLabelModal.tsx`, `UserPassport.tsx` (no imports found). Delete `App.css` (Vite boilerplate, imported nowhere). Change `<title>` in `index.html` to `Selene Admin Panel`. Add or import `scrollbar-hide` utility class. Remove all console.log statements from `usePendingProducts.ts` and `useProductLock.ts`. |
| **Dependencies** | None — can be done independently |

### Phase 2 — Type Safety & Table Migration

| | |
|---|---|
| **Goal** | Eliminate all `any` types and migrate hand-rolled HTML tables to `@tanstack/react-table` |
| **Files** | All 14+ files with `eslint-disable @typescript-eslint/no-explicit-any` — `StatCard.tsx`, `users/*.tsx`, `products/*.tsx`, `disputes/*.tsx`, `VerificationPage.tsx`, `useUsers.ts`, `useOrders.ts`, `useReturns.ts`, `useProducts.ts`, `useDisputes.ts`, `useVerifications.ts`, etc. |
| **Approach** | Replace `any` with `Tables<'...'>`, `Enums<'...'>`, or proper interfaces from `packages/types`. Replace raw `<table>` HTML with `@tanstack/react-table` `useReactTable`, `flexRender`, column defs with `accessorKey`/`accessorFn`, sorting, and pagination. Create a shared `DataTable` UI component wrapping TanStack Table with consistent dark theme styling. Add proper generic type parameters to all custom hooks. |
| **Dependencies** | Phase 1 (cleaner codebase to work in) |

### Phase 3 — Component Breakdown & Responsive Layout

| | |
|---|---|
| **Goal** | Split `VerificationPage` and make `Layout` responsive |
| **Files** | `apps/admin-web/src/pages/VerificationPage.tsx`, `apps/admin-web/src/components/layout/Layout.tsx`, `apps/admin-web/src/components/layout/Sidebar.tsx` (if extracted), new sub-components under `apps/admin-web/src/components/features/verification/` |
| **Approach** | Extract 4 concerns from `VerificationPage` into separate components: `VerificationList` (table with filters), `VerificationDetail` (expanded panel/modal), `EvidenceViewer` (image/docs display), `VerificationActions` (approve/reject buttons + notes). Make `Layout` sidebar collapsible with a hamburger toggle on mobile; use CSS `container` queries or Tailwind `lg:` breakpoints for responsive width; convert fixed bottom bar from `left-64` to responsive positioning. |
| **Dependencies** | Phase 2 (TanStack Table components ready for VerificationList) |

### Phase 4 — KPI Dashboard Enhancements

| | |
|---|---|
| **Goal** | Transform raw KPI numbers into strategic, context-rich metrics |
| **Files** | `apps/admin-web/src/pages/DashboardHome.tsx`, `apps/admin-web/src/components/ui/StatCard.tsx`, `apps/admin-web/src/hooks/useAdminStats.ts`, `apps/admin-web/src/hooks/useAuditLogs.ts`, `apps/admin-web/src/components/features/dashboard/ActivityFeed.tsx` |
| **Approach** | `useAdminStats` — add trend calculation (compare current period vs previous: % change) and target thresholds. `StatCard` — add `trend` prop (+/-/neutral with arrow), `target` prop (progress bar if below target), optional sparkline (7-day mini chart via inline SVG or recharts). DashboardHome — add 2-3 strategic metric cards (MRR, churn rate, LTV/CAC from admin_stats view if available). ActivityFeed — add `isError`/`refetch` handling with error banner + retry button. |
| **Dependencies** | Phase 2 (StatCard types cleaned up) |

### Phase 5 — Data Fetching & Resilience

| | |
|---|---|
| **Goal** | Add missing infrastructure: error boundaries, loading skeletons, query optimization, virtualization |
| **Files** | `apps/admin-web/src/hooks/useUserDetail.ts`, `apps/admin-web/src/components/ui/ErrorBoundary.tsx` (new), `apps/admin-web/src/components/ui/Skeleton.tsx` (new or extend), all page components (add ErrorBoundary wrappers + Skeleton loading states), long-list pages for virtualization |
| **Approach** | `useUserDetail` — wrap each non-critical query in a try-catch guard so one failure can't crash the entire hook; profile query remains critical. Add shared `ErrorBoundary` component wrapping each page route. Replace spinner-only loading with skeleton components matching page layout shape (row skeletons for tables, card skeletons for stat cards). **Virtualization deferred** — current datasets are < 100 rows, `overflow-x-auto` on the table wrapper is sufficient. When datasets grow, add `@tanstack/react-virtual` to DataTable's `<tbody>`. |
| **Dependencies** | Phase 2 (types are clean), Phase 3 (components are split) |

### Phase 6 — Aesthetic Polish

| | |
|---|---|
| **Goal** | Micro-interactions, transitions, and responsive fine-tuning |
| **Files** | All page and component files — subtle animation additions, `tailwind-merge`/`clsx` usage audit, responsive breakpoint adjustments |
| **Approach** | Add `transition-all` + `hover:scale-[1.02]` on interactive cards. Add `framer-motion` or CSS `@keyframes` for page transitions (fade-in on route change). Audit all `className` join patterns for consistency (`clsx`/`twMerge`). Fine-tune responsive breakpoints on tables (horizontal scroll on `md` and below). Ensure all bottom bars and action panels reposition correctly on mobile. |
| **Dependencies** | All previous phases — polish applied last |

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| TanStack Table migration breaks existing table behavior | Medium | Migrate one table per commit, test each. Keep old HTML table as fallback until new one is verified |
| `useUserDetail` aggregate query has different shape | Medium | Write and test the aggregate SQL/view in a local Supabase instance first. Add a migration step |
| VerificationPage split changes user workflow | Low | Component extraction is additive — all sub-components render within the same page route. No navigation change |
| Layout sidebar changes break navigation on desktop | Low | Use Tailwind responsive prefixes — desktop behavior is unchanged, only mobile gets the collapsible behavior. Test at 3 breakpoints |
| Phase 4 sparklines add bundle weight | Low | Use inline SVG (no chart library dependency) — negligible size impact |
| `scrollbar-hide` missing in Tailwind v4 | Low | Tailwind v4 uses CSS `@utility scrollbar-hide { ... }` instead of plugin. Add as custom utility in `index.css` |

## Delivery Strategy

**6 chained PRs, one per phase, stacked onto `main`.**

Each PR targets `main` directly with its own branch. PRs are sequential (Phase 2 depends on Phase 1 being merged, Phase 3 on Phase 2, etc.) because each phase builds on cleaned-up code from the previous one.

| PR | Phase | Est. Lines | Risk |
|----|-------|------------|------|
| 1 | Quick Cleanup | ~50 | Low — deletions and trivial fixes |
| 2 | Type Safety & Tables | ~800 | Medium — most complex change, high surface area |
| 3 | Component Breakdown | ~400 | Medium — structural refactor |
| 4 | KPI Dashboard | ~200 | Low — additive changes |
| 5 | Data Fetching & Resilience | ~300 | Medium — query optimization could cause regressions |
| 6 | Aesthetic Polish | ~150 | Low — purely additive |

Rollback per PR: revert the merge commit. Each PR is scoped so reverting one does not block the others (though later PRs may fail type-check if Phase 2 is reverted).

## Capabilities

None — pure refactor. No spec-level behavior changes. All existing pages, routes, and data contracts remain identical from the user's perspective. The only visible changes are aesthetic (animations, skeletons, responsive behavior) and performance (faster queries, virtualized lists).

## Success Criteria

- [ ] `tsc -b` passes with zero errors in `apps/admin-web`
- [ ] Zero `eslint-disable @typescript-eslint/no-explicit-any` comments remain
- [ ] All hand-rolled HTML `<table>` elements replaced with `@tanstack/react-table`
- [ ] `VerificationPage` under 250 lines (split into focused sub-components)
- [ ] `Layout` sidebar collapses on screens < 1024px
- [ ] Every KPI on DashboardHome shows trend + target context
- [ ] Every page is wrapped in an error boundary
- [ ] Long lists (>50 rows) use virtualization
- [ ] No dead files: `ReturnLabelModal`, `UserPassport`, `App.css` deleted
- [ ] `useUserDetail` fires 3 or fewer queries
- [ ] Loading skeletons render on every async state (no spinner-only states)
- [ ] `ActivityFeed` handles error state with visible retry action
