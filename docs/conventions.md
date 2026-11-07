# Conventions for new code

Reference for structure, naming, and test placement. Apply these rules to every new file, even where the current tree does not follow them yet. `AGENTS.md` wins if the two disagree.

## Dependency direction

Imports go one way: `shared -> features -> app`.

- Shared code never imports a feature or a route. Example: a hook in `shared/hooks` must not import from `features/checkout`.
- A feature never imports another feature. If two features need the same code, move it to `shared`.
- Routes compose features. A route imports screens from features and shared code.

`apps/frontend/frontend-import-boundaries.test.ts` is a `bun:test` that scans imports, forbids imports of `supabase/functions/`, and enforces this direction. ESLint enforces the same rule (`import-x/no-restricted-paths` in `eslint.config.js`, as bulletproof-react does), so the editor flags a wrong import as you type. When a feature needs another feature's piece, compose both in the route or move the piece to `shared/`.

## Keep routes thin

A file under the Expo Router `app/` directory reads route params and renders one screen from a feature. It holds no business logic, data fetching, or large JSX. Example: `apps/frontend/src/app/profile/orders/[id].tsx` only renders `OrderDetailScreen` from `features/orders/screens/`.

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
    ui/  hooks/  utils/  theme/  i18n/  config/  lib/
```

`logic/` holds pure TypeScript with no React imports. Test it without React. Example: `apps/frontend/src/features/checkout/logic/checkout-payment-flow.ts` and its test belong in `features/checkout/logic/`.

`lib/` holds a feature's I/O wrappers: clients, device APIs, and other side effects, mirroring `shared/lib/`. Keep the pure rules next to them in `logic/`. Example: `apps/frontend/src/features/notifications/lib/push-permission.ts` wraps the device permission and `logic/push-permission.logic.ts` holds the decisions.

## Test placement

- A unit test sits next to the file it tests: `foo.ts` and `foo.test.ts`. Example: `apps/frontend/src/shared/i18n/auth-locale-parity.test.ts` sits in `src/shared/i18n/`.
- A flow test that spans several modules sits in the feature folder.
- Playwright specs stay in `e2e/` (`e2e/admin-web/`, `e2e/admin-web-local/`).
- A guard that scans all of `apps/frontend/src/` sits at the `apps/frontend/` root, so it does not scan its own text: `frontend-import-boundaries.test.ts`, `legacy-wallet-removal.test.ts`. A guard over the whole repository sits in `scripts/` (`test-only-guard.test.ts`).
- Do not create new `__tests__/` folders or a top-level `tests/` folder; `scripts/test-placement.test.ts` fails on one. The folders in its legacy list predate this rule; do not add to them.

## Source-text tests

A test runs the code it tests. Call the function, call the Edge Function handler with fake dependencies, mount the screen, or run the SQL with pgTAP (`bun run test:db`, `supabase/tests/database/`). A test that only checks the text of a source file passes when the behavior is broken, and fails when the code is only reformatted (#138).

- Read a file in a test only when the text is the contract (for example, a module must not import another one) or the file is a fixture. Put a line `// source-text: <reason>` in that test file.
- `scripts/source-text-tests.test.ts` counts, per area, the test files that read files (`readFileSync`, `Bun.file(`, `readFile(`) without that line. It fails when an area's count grows. When you convert or delete one of those tests, it fails until you lower the area's number in `scripts/source-text-tests.ts`.
- Roadmap #272 converts the older tests. When you touch a frontend or admin-web file whose test checks its wiring as text, mount the screen in that test instead.

## File naming

- Every file uses kebab-case: `product-card.tsx` exports `ProductCard`, `use-auth.ts` exports `useAuth`, `format-price.ts` exports `formatPrice`. Identifiers inside the file keep their usual case.
- Why: Windows and macOS file systems ignore case and the Linux CI does not, so an import that differs only in case works locally and fails in CI. All-lowercase names remove that class of error. The Expo SDK 55 template and bulletproof-react use the same style.
- Exception: route files under the Expo Router `app/` directory. Their names are URLs and deep links (`(auth)/resetPassword.tsx` is `/resetPassword`), so rename one only as a deliberate route change.
- `bun run lint` enforces it for `apps/frontend/src` outside `app/` (`check-file/filename-naming-convention` in `eslint.config.js`). Only the part before the first dot is checked, so `order-action-card.cancelled-banner.test.ts` and `captcha.logic.ts` pass.
- Edge Function directories under `supabase/functions/` are kebab-case because they are the function names (`create-connect-payment`). The Deno files inside them are kebab-case too (`fee-calculator.ts`). Keep that style in Deno code. These rules do not apply to it.

## File size

A non-test file under `apps/frontend/src` past 400 lines of code (blank lines and comments not counted) gets a `max-lines` lint warning (#135). It does not block lint. When a file you change shows it, split the screen into a thin screen plus components and hooks, as the order screens were (`features/orders/screens/`), in its own commit.

## No barrel files

Do not add an `index.ts` that only re-exports. Import the file directly. An `index.ts` that defines code, such as `apps/frontend/src/shared/theme/index.ts`, is not a barrel and stays.

## Formatting

Prettier formats the repository (`.prettierrc.js`; `bun run format` writes every file). The pre-commit hook formats staged code, Markdown, JSON, and YAML, and CI runs `bun run format:check` on every file. `.gitattributes` checks text files out with LF on every OS, as Prettier writes them.

- A formatting-only change goes in its own `style(...)` commit, never mixed with a behavior change. Format first, then change or move the code, so the pre-commit hook never has to be skipped.
- Add the full hash of each formatting-only commit to `.git-blame-ignore-revs`. GitHub's blame view reads it; locally, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone.

## Sources

- Expo blog, "How to organize Expo app folder structure for clarity and scalability".
- bulletproof-react, `docs/project-structure.md`.
