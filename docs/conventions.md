# Conventions for new code

Reference for structure, naming, and test placement. Apply these rules to every new file, even where the current tree does not follow them yet. `AGENTS.md` wins if the two disagree.

## Dependency direction

Imports go one way: `shared -> features -> app`.

- Shared code never imports a feature or a route. Example: a hook in `shared/hooks` must not import from `features/checkout`.
- A feature never imports another feature. If two features need the same code, move it to `shared`.
- Routes compose features. A route imports screens from features and shared code.

`apps/frontend/core/utils/frontendImportBoundaries.test.ts` is a `bun:test` that scans imports and already forbids imports of `supabase/functions/`. The layout migration extends it to enforce this direction. Until then, review enforces it.

## Keep routes thin

A file under the Expo Router `app/` directory reads route params and renders one screen from a feature. It holds no business logic, data fetching, or large JSX.

Counterexample today: `apps/frontend/app/profile/orders/[id].tsx` has about 1000 lines. Do not copy that shape.

## Frontend layout

The current tree under `apps/frontend/` is `app/`, `core/`, and `components/`. The target layout below is not in place yet. Phases 5 and 6 of `odd/tasks/repo-hygiene.md` migrate to it.

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

`logic/` holds pure TypeScript with no React imports. Test it without React. Example: `apps/frontend/core/utils/checkoutPaymentFlow.ts` and its test belong in `features/checkout/logic/`.

Until the move, follow these rules in the current tree:

- Do not add domain logic to `core/utils`. It is a grab bag today and must not grow.
- Put new domain components in the existing domain folder under `apps/frontend/components/features/<domain>/`, for example `components/features/orders/`.

## Test placement

- A unit test sits next to the file it tests: `foo.ts` and `foo.test.ts`. Example: `apps/frontend/core/i18n/authLocaleParity.test.ts` sits in `core/i18n/`.
- A flow test that spans several modules sits in the feature folder.
- Playwright specs stay in `e2e/` (`e2e/admin-web/`, `e2e/admin-web-local/`).
- Do not create new `__tests__/` folders. Do not add files to `apps/frontend/tests/` or to the root `tests/`. Existing ones move during the layout migration.

## File naming

- React component files use PascalCase: `ProductCard.tsx`.
- Every other file uses camelCase: hooks as `useX.ts`, utilities as `formatPrice.ts`.
- Rename an existing kebab-case file when its area migrates. Do not rename it earlier.
- Edge Function directories under `supabase/functions/` are kebab-case because they are the function names (`create-connect-payment`). The Deno files inside them are kebab-case too (`fee-calculator.ts`). Keep that style in Deno code. These rules do not apply to it.

At the commit that introduced this file, the non-test `.ts` and `.tsx` files in `apps/frontend/app`, `core`, and `components` were 162 PascalCase, 207 camelCase, and 21 kebab-case. Regenerate the counts from the repository root:

```bash
git ls-files apps/frontend/app apps/frontend/core apps/frontend/components \
  | grep -vE '\.test\.' | grep -E '\.(ts|tsx)$' \
  | xargs -n1 basename | sed 's/\.[^.]*$//' \
  | awk '/-/{k++;next} /^[A-Z]/{p++;next} {c++} END{print p, c, k}'
```

The output is PascalCase, camelCase, and kebab-case counts, in that order.

## No barrel files

Do not add an `index.ts` that only re-exports. Import the file directly. An `index.ts` that defines code, such as `apps/frontend/core/theme/index.ts`, is not a barrel and stays.

## Sources

- Expo blog, "How to organize Expo app folder structure for clarity and scalability".
- bulletproof-react, `docs/project-structure.md`.
