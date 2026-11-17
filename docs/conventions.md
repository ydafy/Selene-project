# Conventions for new code

Reference for structure, naming, and test placement. Apply these rules to every new file, even where the current tree does not follow them yet. `AGENTS.md` wins if the two disagree.

## Design target

Design every table, job, and flow to carry this volume without a rewrite. It is roughly the whole volume of today's five largest Mexican Facebook groups for buying and selling PC hardware, with margin. The evidence is in `docs/decision-log.md`, "2026-11-16: Design for 50k Users and 5k Orders a Month".

| Measure          | Target                |
| ---------------- | --------------------- |
| Registered users | 50,000                |
| Orders           | 5,000 a month         |
| Peak             | 500 orders in one day |
| Active listings  | 100,000               |

At this volume Postgres is not the limit. Manual work and data that can no longer be fixed break first. A design meets the target when:

- No routine flow needs a person to reconcile, look up, or repair data by hand. Money is reconciled from one record of its movements, not by joining tables.
- History is appended, never overwritten. A refund retry, a verification attempt, or an admin decision leaves its own row.
- Every table that grows with use has a retention rule: a purge job, or a stated reason to keep its rows forever.
- Stored data does not depend on its presentation. A notification stores its event and data, and the app renders the text in the user's language.
- Changing the design later does not mean migrating live money data.

Use this rule to decide when to build something:

| Cost now | Cost later                                                    | Decision                                                              |
| -------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Low      | High: migrating live data, lost history, money in flight      | Build it now, even if the first year barely needs it                  |
| Low      | Low: purely additive (a column, table, index, job, or screen) | Build it when a feature needs it                                      |
| High     | Any                                                           | Build it now only for money, security, or data that cannot be rebuilt |

Do not build for more than the target. Sharding, read replicas, partitions, and caches need a measurement that shows the target requires them.

## Dependency direction

Imports go one way: `shared -> features -> app`.

- Shared code never imports a feature or a route. Example: a hook in `apps/frontend/src/shared/hooks/` must not import from `apps/frontend/src/features/checkout/`.
- A feature never imports another feature. If two features need the same code, move it to `shared`.
- Routes compose features. A route imports screens from features and shared code.

`apps/frontend/frontend-import-boundaries.test.ts` is a `bun:test` that scans imports, forbids imports of `supabase/functions/`, and enforces this direction. ESLint enforces the same rule in both apps (`import-x/no-restricted-paths` in `eslint.config.js`, as bulletproof-react does), so the editor flags a wrong import as you type. When a feature needs another feature's piece, compose both in the route or move the piece to `apps/frontend/src/shared/`.

## Keep routes thin

A file under the Expo Router `apps/frontend/src/app/` directory reads route params and renders one screen from a feature. It holds no business logic, data fetching, or large JSX. Example: `apps/frontend/src/app/profile/orders/[id].tsx` only renders `OrderDetailScreen` from `apps/frontend/src/features/orders/screens/`.

## Frontend layout

```text
apps/frontend/src/
  app/                  Expo Router routes
  features/<domain>/
    screens/
    components/
    hooks/
    logic/              pure domain code, no React
    lib/                I/O wrappers: clients, device APIs, side effects
  shared/
    ui/  hooks/  utils/  theme/  i18n/  config/  lib/  store/
```

`apps/frontend/src/shared/` holds only code that two or more features use, that `apps/frontend/src/app/` uses, or that other shared code uses. When only one feature uses a shared file, move it into that feature with `scripts/dev/move-files.ts`, then run `bun scripts/dev/alias-imports.ts apps/frontend --apply`, because the move leaves the moved file's own imports relative.

Large shared folders group files by topic, not by type, one level deep: `apps/frontend/src/shared/ui/` has the topic folders address, button, feedback, form, icons, layout, media, and product, and `apps/frontend/src/shared/utils/` has money. A topic folder needs at least two modules; a file with no topic yet stays directly in the parent folder, as `apps/frontend/src/shared/utils/format-date.ts` does. Smaller folders (`apps/frontend/src/shared/hooks/`, `apps/frontend/src/shared/lib/`) stay flat until a clear cluster appears, as `apps/frontend/src/shared/lib/auth/` did.

An import that leaves its top-level folder (the app folder, the shared folder, or one feature) uses the `@/` alias, which maps to `apps/frontend/src/`: `import { formatCents } from '@/shared/utils/money/format-cents'`. Imports inside the same folder stay relative. `bun run lint` enforces it with the local rule `relative-import-outside-folder` in `eslint.config.js`, which also checks the first argument of `mock.module()`, `jest.mock()`, and `require()`.

`apps/frontend/src/features/<domain>/logic/` holds pure TypeScript with no React imports. Test it without React. Example: `apps/frontend/src/features/checkout/logic/checkout-payment-flow.ts` and its test belong in `apps/frontend/src/features/checkout/logic/`.

`apps/frontend/src/features/<domain>/lib/` holds a feature's I/O wrappers: clients, device APIs, and other side effects, mirroring `apps/frontend/src/shared/lib/`. Keep the pure rules next to them in `apps/frontend/src/features/<domain>/logic/`. Example: `apps/frontend/src/features/notifications/lib/push-permission.ts` wraps the device permission and `apps/frontend/src/features/notifications/logic/push-permission.logic.ts` holds the decisions.

## admin-web layout

```text
apps/admin-web/src/
  main.tsx  index.css   entry point and global styles
  app/                  router, providers, layout, error boundary
  features/<domain>/
    screens/
    components/
    hooks/
    logic/              pure domain code, no React
    lib/                I/O wrappers: Edge Function calls, scripts
  shared/
    ui/  hooks/  lib/  store/  utils/
```

The same rules as the frontend apply: a screen lives in its feature (`apps/admin-web/src/features/payments/screens/payments-screen.tsx`), and `apps/admin-web/src/app/app.tsx` only maps routes to screens. There is no api folder: Edge Function calls go in the feature's lib folder (`apps/admin-web/src/features/shipments/lib/carrier-reviews-api.ts`) and the parsers they use in its logic folder (`apps/admin-web/src/features/shipments/logic/carrier-reviews.ts`).

`apps/admin-web/src/shared/` holds only code that two or more features use, or that other shared code uses. The session lives there (`apps/admin-web/src/shared/store/use-auth-store.ts`, `apps/admin-web/src/shared/lib/auth/`), because most features read it; the login screen and the captcha live in `apps/admin-web/src/features/auth/`. When only one feature uses a shared file, move it into that feature with `scripts/dev/move-files.ts`.

An import that leaves its top-level folder (the app folder, the shared folder, or one feature; the files directly in `apps/admin-web/src/` are one group) uses the `@/` alias, which maps to `apps/admin-web/src/`: `import { Modal } from '@/shared/ui/modal'`. Imports inside the same folder stay relative. `bun run lint` enforces it with the local rule `relative-import-outside-folder` in `eslint.config.js`, the same rule the frontend uses.

## Test placement

- A unit test sits next to the file it tests: `<name>.ts` and `<name>.test.ts`. Example: `apps/frontend/src/shared/i18n/auth-locale-parity.test.ts` sits in `apps/frontend/src/shared/i18n/`.
- A flow test that spans several modules sits in the feature folder.
- Playwright specs stay in `e2e/` (`e2e/admin-web/`, `e2e/admin-web-local/`).
- A guard that scans all of `apps/frontend/src/` sits at the `apps/frontend/` root, so it does not scan its own text: `apps/frontend/frontend-import-boundaries.test.ts`, `apps/frontend/legacy-wallet-removal.test.ts`. A guard over the whole repository sits in `scripts/guards/` (`scripts/guards/test-only-guard.test.ts`).
- Do not create new `__tests__` folders or a top-level `tests` folder; `scripts/guards/test-placement.test.ts` fails on one. The folders in its legacy list predate this rule; do not add to them.
- SQL behavior is tested with pgTAP in `supabase/tests/database/`, against the migrated local database (`bun run test:db`); `supabase/migrations/` holds only migrations. `supabase/functions/_shared/__tests__/` keeps only the guards that scan every Edge Function and the zod preload `bunfig.toml` loads.

## Source-text tests

A test runs the code it tests. Call the function, call the Edge Function handler with fake dependencies, mount the screen, or run the SQL with pgTAP (`bun run test:db`, `supabase/tests/database/`). A test that only checks the text of a source file passes when the behavior is broken, and fails when the code is only reformatted (#138).

- Read a file in a test only when the text is the contract (for example, a module must not import another one) or the file is a fixture. Put a line `// source-text: <reason>` in that test file.
- `scripts/guards/source-text-tests.test.ts` counts, per area, the test files that read files (`readFileSync`, `Bun.file(`, `readFile(`) without that line. It fails when an area's count grows. When you convert or delete one of those tests, it fails until you lower the area's number in `scripts/guards/source-text-tests.ts`.
- Roadmap #272 converts the older tests. When you touch a frontend or admin-web file whose test checks its wiring as text, mount the screen in that test instead.

## Database grants

- Every new table, view, sequence or function states in its schema file exactly what `anon` and `authenticated` get, and nothing by default. The procedure and the two tests that pin the lists are in `supabase/AGENTS.md`, "Declarative schema".
- A server-only object goes in the `internal` schema or stays in `public` depending on who calls it. The rule is in `supabase/AGENTS.md`, "Declarative schema".

## Database names

These rules apply to new objects. Existing indexes keep their names (`idx_*`, `ix_*` and `*_idx` all exist); rename one only when a migration already rewrites it.

- Indexes: `<table>_<columns>_idx`, or `<table>_<purpose>_idx` when the columns do not say what the index is for (`addresses_one_default_per_user_idx`). This is the name Postgres would generate, so it matches the constraint names below.
- Constraints keep the names Postgres generates: `<table>_pkey`, `<table>_<column>_fkey`, `<table>_<columns>_key` and `<table>_<column>_check`. A CHECK over several columns gets `<table>_<purpose>_check` (`system_settings_active_limits_check`).
- Enum types are named after what they hold, without an `_enum` suffix (`order_status`, `user_role`). Their values are lowercase snake_case (`under_review`). `product_status` still has uppercase values until #308 lowercases them.
- Money columns hold integer cents and end in `_cents` (`shipping_cost_cents`).

## File naming

- Every file uses kebab-case: `apps/frontend/src/shared/ui/product/product-card.tsx` exports `ProductCard`, `apps/frontend/src/features/auth/hooks/use-auth.ts` exports `useAuth`, `apps/frontend/src/shared/utils/money/format-cents.ts` exports `formatCents`. Identifiers inside the file keep their usual case.
- Why: Windows and macOS file systems ignore case and the Linux CI does not, so an import that differs only in case works locally and fails in CI. All-lowercase names remove that class of error. The Expo SDK 55 template and bulletproof-react use the same style.
- Exception: route files under the Expo Router `apps/frontend/src/app/` directory. Their names are URLs and deep links (`apps/frontend/src/app/(auth)/resetPassword.tsx` is `/resetPassword`), so rename one only as a deliberate route change.
- `bun run lint` enforces it for all of `apps/admin-web/src` and `supabase/functions`, and for `apps/frontend/src` outside `apps/frontend/src/app/` (`check-file/filename-naming-convention` in `eslint.config.js`). Only the part before the first dot is checked, so `apps/frontend/src/features/orders/components/order-action-card.cancelled-banner.test.ts` and `apps/frontend/src/shared/lib/auth/captcha.logic.ts` pass.
- Edge Function directories under `supabase/functions/` are kebab-case because they are the function names (`create-connect-payment`). The Deno files inside them are kebab-case too (`supabase/functions/create-connect-payment/fee-calculator.ts`).

## File size

A non-test file under `apps/frontend/src`, `apps/admin-web/src`, or `supabase/functions` past 400 lines of code (blank lines and comments not counted) gets a `max-lines` lint warning (#135). It does not block lint. When a file you change shows it, split the screen into a thin screen plus components and hooks, as the order screens were (`apps/frontend/src/features/orders/screens/`), in its own commit.

## No barrel files

Do not add an index file that only re-exports. Import the file directly. An index file that defines code, such as `apps/frontend/src/shared/theme/index.ts`, is not a barrel and stays.

## Operational docs

Markdown goes under `docs/`, never next to code. Name new files in kebab-case.

- A procedure someone will run again (a recovery, a deployed check, an inventory to collect) goes in `docs/runbooks/`.
- How a feature behaves, its rules, and its limits go in `docs/specs/`.
- A decision and its reason go in `docs/decision-log.md` as one dated entry.
- A deployment note for one change goes in the PR description or the feature document under `odd/tasks/`. Once it is applied, it is history: do not keep a separate file for it.

Other Markdown homes are `odd/`, `design/`, `.agents/`, `.github/`, `AGENTS.md` and `README.md` files, and the root `DESIGN.md` and `SECURITY.md`. `scripts/guards/markdown-placement.test.ts` fails on a Markdown file anywhere else.

## Repository scripts

A script in `scripts/` goes in the folder for its purpose, with its test next to it:

- `scripts/dev/`: tools a developer or a Git hook runs (`worktree-env`, `stripe-listen`).
- `scripts/ci/`: helpers a workflow runs (`check-commit-msg`, `dependency-report`).
- `scripts/guards/`: tests over the whole repository that fail on a broken rule (`agent-instructions`, `markdown-placement`).
- `scripts/verify/`: verification harnesses against the local stack (`test-shipment-*`, `postgres-smoke`). `scripts/verify/test-shipment-lifecycle-model.ts` is a model-based harness: it runs random sequences of the shipment and payout RPCs, and its `--help` says how to replay a failure. `scripts/verify/run-harnesses.ts` lists each one in a group: `pr` runs in the `db-test` CI job, `weekly` in a weekly workflow, and the manual ones say why. Run a group with `bun run verify:harnesses --group pr`. A new harness goes in a list, or `scripts/guards/verify-harness-lists.test.ts` fails.

A script under `scripts/<folder>/` reaches the repository root with `join(import.meta.dir, '..', '..')`. `scripts/guards/script-folders.test.ts` fails on a file anywhere else in `scripts/`.

Move files with `scripts/dev/move-files.ts`, not by hand. Write a JSON array of `[oldPath, newPath]` pairs of repo-relative file paths and run `bun scripts/dev/move-files.ts <mapping.json> --dry-run`, then again without `--dry-run`: it moves the files with `git mv`, rewrites the imports (each app's `@/` alias included) and path strings that point at them, and lists the strings it could not rewrite.

Convert relative imports to the `@/` alias with `scripts/dev/alias-imports.ts`. Run `bun scripts/dev/alias-imports.ts <app>` (for example `apps/admin-web`) to print the plan, then again with `--apply`: in the app's source folder, tests included, it rewrites every relative specifier that leaves its top-level folder (the app folder, the shared folder, or one feature; the files directly in the source folder are one group) to `@/`, keeps the ones that stay inside it, and lists the template specifiers it could not rewrite.

## Formatting

Prettier formats the repository (`.prettierrc.js`; `bun run format` writes every file). The pre-commit hook formats staged code, Markdown, JSON, and YAML, and CI runs `bun run format:check` on every file. `.gitattributes` checks text files out with LF on every OS, as Prettier writes them.

- A formatting-only change goes in its own `style(...)` commit, never mixed with a behavior change. Format first, then change or move the code, so the pre-commit hook never has to be skipped.
- Add the full hash of each formatting-only commit to `.git-blame-ignore-revs`. GitHub's blame view reads it; locally, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone.

## Sources

- Expo blog, "How to organize Expo app folder structure for clarity and scalability".
- bulletproof-react, the project structure page in its `docs` folder.
