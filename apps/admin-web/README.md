# admin-web

The Selene admin dashboard: React, Vite, TanStack Query, and Tailwind CSS. Admins verify listings, resolve disputes, release payouts, and handle shipment problems here.

## Commands

Run these from `apps/admin-web`:

- `bun run dev`: Vite dev server.
- `bun run build`: typecheck and production build into `dist/`.
- `bun run typecheck`: `tsc -b`, app code and tests.
- `bun run lint`: ESLint with the root `eslint.config.js`. admin-web has no ESLint config of its own.

Tests run from the repository root: `bun test apps/admin-web` for unit tests, and `bun run test:e2e` for the Playwright specs in `e2e/admin-web/`.

## Layout

`src/app/` holds the router and providers, `src/features/<domain>/` holds each feature, and `src/shared/` holds only code that two or more features use. Imports go `shared -> features -> app`. `docs/conventions.md` describes the layout and the rules ESLint enforces.
