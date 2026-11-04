# Frontend guide

Expo React Native app. Read `docs/conventions.md` first for structure, naming, and test placement.

## Styling

- Style with Restyle, not NativeWind. The theme is `apps/frontend/src/shared/theme/index.ts` (`createTheme`) with tokens in `src/shared/theme/tokens.ts`. Primitives such as `Box` and `Text` live in `src/shared/ui/base.ts`.
- `DESIGN.md` describes how the UI should look.

## Strings

- Every user-facing string goes through i18n, in English and Spanish: `src/shared/i18n/locales/en` and `src/shared/i18n/locales/es`.
- Locale parity tests (`src/shared/i18n/*locale-parity.test.ts`) fail when the two languages differ.

## Dependencies and types

- Run `expo install` from `apps/frontend`, never from the repository root.
- Import database types from `@selene/types` and use the typed aliases (`Tables<'orders'>`, `Enums<'order_status_enum'>`).

## Tests and checks

- Put a unit test next to its file (`foo.ts`, `foo.test.ts`). Add no new `__tests__/` folders.
- Run the touched tests with `bun test <path>`.
- Typecheck with `bun run --filter @selene/frontend typecheck`. It passes with zero errors; keep it that way.
