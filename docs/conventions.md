# Conventions for new code

Reference for structure, naming, and test placement. Apply these rules to every new file, even where the current tree does not follow them yet. `AGENTS.md` wins if the two disagree.

## Dependency direction

Imports go one way: `shared -> features -> app`.

- Shared code never imports a feature or a route. Example: a hook in `shared/hooks` must not import from `features/checkout`.
- A feature never imports another feature. If two features need the same code, move it to `shared`.
- Routes compose features. A route imports screens from features and shared code.

`apps/frontend/src/core/utils/frontendImportBoundaries.test.ts` is a `bun:test` that scans imports and already forbids imports of `supabase/functions/`. The layout migration extends it to enforce this direction, and adds the same rule to ESLint (`import/no-restricted-paths`, as bulletproof-react does) so the editor flags a wrong import as you type. Until then, review enforces it.

## Keep routes thin

A file under the Expo Router `app/` directory reads route params and renders one screen from a feature. It holds no business logic, data fetching, or large JSX.

Counterexample today: `apps/frontend/src/app/profile/orders/[id].tsx` has about 1000 lines. Do not copy that shape.

## Frontend layout

The current tree under `apps/frontend/src/` is `app/`, `core/`, and `components/` (#133 moved them under `src/`). The `features/` and `shared/` folders below are not in place yet; #134 migrates to them, one domain at a time (`odd/tasks/frontend-layout.md`).

```text
apps/frontend/src/
  app/                  Expo Router routes
  features/<domain>/
    screens/
    components/
    hooks/
    logic/              pure domain code, no React
  shared/
    ui/  hooks/  utils/  theme/  i18n/  config/  lib/
```

`logic/` holds pure TypeScript with no React imports. Test it without React. Example: `apps/frontend/src/core/utils/checkoutPaymentFlow.ts` and its test belong in `features/checkout/logic/`.

Until the move, follow these rules in the current tree:

- Do not add domain logic to `core/utils`. It is a grab bag today and must not grow.
- Put new domain components in the existing domain folder under `apps/frontend/src/components/features/<domain>/`, for example `components/features/orders/`.

## Test placement

- A unit test sits next to the file it tests: `foo.ts` and `foo.test.ts`. Example: `apps/frontend/src/core/i18n/authLocaleParity.test.ts` sits in `src/core/i18n/`.
- A flow test that spans several modules sits in the feature folder.
- Playwright specs stay in `e2e/` (`e2e/admin-web/`, `e2e/admin-web-local/`).
- Do not create new `__tests__/` folders. Do not add files to `apps/frontend/tests/` or to the root `tests/`. Existing ones move during the layout migration.

## File naming

- Every file uses kebab-case: `product-card.tsx` exports `ProductCard`, `use-auth.ts` exports `useAuth`, `format-price.ts` exports `formatPrice`. Identifiers inside the file keep their usual case.
- Why: Windows and macOS file systems ignore case and the Linux CI does not, so an import that differs only in case works locally and fails in CI. All-lowercase names remove that class of error. The Expo SDK 55 template and bulletproof-react use the same style.
- Exception: route files under the Expo Router `app/` directory. Their names are URLs and deep links (`(auth)/resetPassword.tsx` is `/resetPassword`), so rename one only as a deliberate route change.
- Rename an existing PascalCase or camelCase file when its area migrates to `features/` or `shared/` (#134), in the same `git mv`. Do not rename it earlier.
- Edge Function directories under `supabase/functions/` are kebab-case because they are the function names (`create-connect-payment`). The Deno files inside them are kebab-case too (`fee-calculator.ts`). Keep that style in Deno code. These rules do not apply to it.

At the commit that introduced this file, the non-test `.ts` and `.tsx` files in `apps/frontend/app`, `core`, and `components` (now under `apps/frontend/src/`) were 162 PascalCase, 207 camelCase, and 21 kebab-case. Regenerate the counts from the repository root to follow the move to kebab-case:

```bash
git ls-files apps/frontend/src \
  | grep -vE '\.test\.' | grep -E '\.(ts|tsx)$' \
  | xargs -n1 basename | sed 's/\.[^.]*$//' \
  | awk '/-/{k++;next} /^[A-Z]/{p++;next} {c++} END{print p, c, k}'
```

The output is PascalCase, camelCase, and kebab-case counts, in that order.

## No barrel files

Do not add an `index.ts` that only re-exports. Import the file directly. An `index.ts` that defines code, such as `apps/frontend/src/core/theme/index.ts`, is not a barrel and stays.

## Formatting

Prettier formats the repository (`.prettierrc.js`; `bun run format` writes every file).

- A formatting-only change goes in its own `style(...)` commit, never mixed with a behavior change. Format first, then change or move the code, so the pre-commit hook never has to be skipped.
- Add the full hash of each formatting-only commit to `.git-blame-ignore-revs`. GitHub's blame view reads it; locally, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once per clone.

## Sources

- Expo blog, "How to organize Expo app folder structure for clarity and scalability".
- bulletproof-react, `docs/project-structure.md`.
