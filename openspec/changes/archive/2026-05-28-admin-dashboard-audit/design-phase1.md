# Design: Phase 1 — Quick Cleanup

## Technical Approach

Phase 1 is purely mechanical — deletions and trivial fixes with zero architectural risk. Each change is independent and independently verifiable.

**Deletion verification protocol**: Before deleting each file, confirm zero imports via `git grep <symbol|path> apps/admin-web/src --include='*.{ts,tsx}'` (excluding the file itself). Delete only when grep returns zero matches.

**Build gating**: After all changes, `bun run build` and `bunx tsc -b` in `apps/admin-web` must both exit 0. If either fails, the change that caused it must be identified and reverted.

## Architecture Decisions

### Decision: Delete files directly, no deprecation period

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Deprecate with warning log + keep file | Adds noise, no consumers exist | ❌ Rejected |
| Soft-delete (empty export) | Misleading — suggests something is exported | ❌ Rejected |
| Hard delete | Cleanest. Imports confirmed zero. | ✅ Selected |

**Rationale**: All three targets (`ReturnLabelModal`, `UserPassport`, `App.css`) have zero import references confirmed via grep. A deprecation period adds maintenance cost with zero benefit.

### Decision: Tailwind v4 `@utility` for `scrollbar-hide`

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Tailwind v3 plugin in config | Project uses Tailwind v4 (`@import 'tailwindcss'` in index.css, no config file) | ❌ Rejected |
| Inline `class:` styles in every usage | Duplicates 3 times, violates DRY | ❌ Rejected |
| `@utility scrollbar-hide { ... }` in index.css | Tailwind v4 native pattern, adjacent to existing `@theme`/`@layer base` blocks | ✅ Selected |

**Rationale**: The project uses Tailwind v4 (`@import 'tailwindcss'` syntax). Tailwind v4 replaces the v3 `plugins` API with CSS-native `@utility`. Placing the definition in `index.css` keeps all custom utilities in one file.

The exact CSS:

```css
@utility scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
```

### Decision: Strip console.* calls, preserve error paths via existing toast

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Replace console.error with toast.error | Changes user-visible behavior (specs forbid this) | ❌ Rejected |
| Wrap in `if (process.env.NODE_ENV !== 'production')` | Adds noise, dev-only logs rarely read | ❌ Rejected |
| Remove all console.* calls | Error paths already surface via `toast.error()` (lines 154, 189 in usePendingProducts; lines 72, 78 in useProductLock) | ✅ Selected |

**Rationale**: All error paths already trigger `toast.error()` or `toast.warning()` for the admin user. The `console.*` calls only duplicate what the toast already communicates. Removing them is pure cleanup with no behavioral change.

## Data Flow

No data flow changes. All modifications are:
- **Deletions** of files that participate in zero data flow (no consumers exist).
- **Cosmetic edits** to hooks that remove debug logging without touching query logic, mutation logic, or state management.
- **CSS utility addition** that only affects presentation (scrollbar visibility).
- **HTML title change** that only affects browser UI.

No component re-renders, no store updates, no API call behavior changes.

## File Changes

| File | Action | Impact |
|------|--------|--------|
| `src/components/features/disputes/ReturnLabelModal.tsx` | Delete | Dead component, zero imports. Deletion cannot break anything. |
| `src/components/features/users/UserPassport.tsx` | Delete | Dead component, zero imports. Deletion cannot break anything. |
| `src/App.css` | Delete | Vite boilerplate, imported by nobody. `main.tsx` imports only `./index.css`; `App.tsx` has no CSS import; grep for `App.css` returns zero. |
| `index.html` | Modify | Change `<title>admin-web</title>` → `<title>Selene Admin Panel</title>`. Single-line change. |
| `src/hooks/usePendingProducts.ts` | Modify | Remove 10 `console.log`/`console.error` calls. No logic change. |
| `src/hooks/useProductLock.ts` | Modify | Remove 10 `console.log`/`console.warn`/`console.error` calls. No logic change. |
| `src/index.css` | Modify | Add `@utility scrollbar-hide { ... }` block after `@layer base`. 3 consumers already exist but fail silently. |

## Component Tree Impact

**Before deletion:**
```
App.tsx
├── Layout
│   ├── VerificationPage
│   │   └── (uses scrollbar-hide — unresolved)
│   ├── UsersPage
│   │   └── (uses scrollbar-hide — unresolved)
│   ├── DisputesPage
│   │   └── (ReturnLabelModal — NO LONGER IMPORTED)
│   └── UserDetailPage
│       └── (UserPassport — NO LONGER IMPORTED)
└── main.tsx
    └── index.css
```

**After deletion:**
```
App.tsx
├── Layout
│   ├── VerificationPage
│   │   └── scrollbar-hide → resolved via @utility
│   ├── UsersPage
│   │   └── scrollbar-hide → resolved via @utility
│   ├── DisputesPage       (unchanged — no import removed)
│   └── UserDetailPage      (unchanged — no import removed)
└── main.tsx
    └── index.css + @utility scrollbar-hide
```

**Untouched files**: All pages, all other hooks, all UI components, all store files, all type definitions, all configuration files.

## Rollback Strategy

Each change is independent and individually revertable:

| Change | Rollback Command | Notes |
|--------|-----------------|-------|
| Delete `ReturnLabelModal.tsx` | `git checkout -- apps/admin-web/src/components/features/disputes/ReturnLabelModal.tsx` | File restored as-is |
| Delete `UserPassport.tsx` | `git checkout -- apps/admin-web/src/components/features/users/UserPassport.tsx` | File restored as-is |
| Delete `App.css` | `git checkout -- apps/admin-web/src/App.css` | File restored as-is |
| Title change | `git checkout -- apps/admin-web/index.html` | Reverts to `admin-web` |
| console.log removal | `git checkout -- apps/admin-web/src/hooks/usePendingProducts.ts apps/admin-web/src/hooks/useProductLock.ts` | Logs restored |
| scrollbar-hide utility | `git checkout -- apps/admin-web/src/index.css` | Reverts to no utility (consumers still use class, no build error) |

Bulk rollback if needed: `git revert <merge-commit>` for the Phase 1 PR.

## Verification Steps

| Criterion | Command |
|-----------|---------|
| `ReturnLabelModal.tsx` gone + no dangling imports | `git ls-files --deleted \| grep ReturnLabelModal` + `git grep 'ReturnLabelModal' apps/admin-web/src` returns 0 |
| `UserPassport.tsx` gone + no dangling imports | `git ls-files --deleted \| grep UserPassport` + `git grep 'UserPassport' apps/admin-web/src` returns 0 |
| `App.css` gone + no imports | `git ls-files --deleted \| grep App.css` + `git grep 'App.css' apps/admin-web/src` returns 0 |
| Title updated | `grep '<title>' apps/admin-web/index.html` outputs `Selene Admin Panel` |
| No console.* in hooks | `grep -n 'console\.' apps/admin-web/src/hooks/usePendingProducts.ts apps/admin-web/src/hooks/useProductLock.ts` returns 0 |
| scrollbar-hide defined | `grep '@utility scrollbar-hide' apps/admin-web/src/index.css` returns the definition |
| Type-check passes | `cd apps/admin-web && bunx tsc -b` exits 0 |
| Build passes | `cd apps/admin-web && bun run build` exits 0 |

## Interfaces / Contracts

No interfaces, types, or contracts are created, modified, or removed. The `@utility scrollbar-hide` is a CSS-only contract consumed by 3 existing HTML className usages — it simply resolves a previously unresolved class reference.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Build | All files compile | `bun run build` exits 0 |
| Type-check | No type errors | `bunx tsc -b` exits 0 |
| Imports | No dangling references | `git grep` for each deleted symbol returns 0 |
| Visual | Title visible in browser | Open dev server, check document.title or `<title>` in HTML |
| Visual | scrollbar-hide works | Inspect a container with the class — scrolls but no bar visible |

No unit or integration tests exist for the removed/debug files, and none are introduced. Existing hook behavior is unchanged (only console.* calls removed).

## Open Questions

None. All changes are verified against the current codebase state.
