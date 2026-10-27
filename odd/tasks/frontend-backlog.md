# Frontend backlog: BL19, BL20, BL21

Close the three frontend items of `odd/tasks/cross-module-backlog.md`. Branch `fix/frontend-backlog`, worktree `School-portal-worktrees/remove-legacy-wallet` (shared with `feat/remove-legacy-wallet`, which resumes after this branch).

## Specs

- S1 (BL20, verbatim): "Hardcoded Spanish: tab titles `'Inicio'`, `'Buscar'`, `'Vender'`, `'Carrito'`, `'Perfil'` in `app/(tabs)/_layout.tsx`, and 5 Spanish `defaultValue`s passed to `t()` (e.g. `prepare/[id].tsx` "Guía ya generada"). English users see Spanish."
- S2 (BL19, verbatim): "14 typecheck errors outside test files, several may be real bugs: `app/profile/orders/report/[id].tsx:465` renders `WizardSteps` without its required `steps`; `OrderCard.tsx` reads `items` 6 times on `EnrichedOrder`, which has no such field; `PaymentMethodPickerModal.tsx:66` reads `setupIntent` that the response type lacks; `prepare/[id].tsx:242` reads `RawOrder.shipments`; `previewProductBuilder.ts:25` builds a product missing fields. Check each against the real data before fixing types."
- S3 (BL21, verbatim): "`app.json` sets `"userInterfaceStyle": "automatic"`, but DESIGN.md says the app is dark only. On a phone in light mode the system UI (keyboard, date pickers, alerts) follows light mode. Probably `"dark"`; confirm on device."

## Tasks

- [x] T1 (S1) tab titles and the `defaultValue`s through i18n, both locales, with a test (`core/i18n/__tests__/hardcodedSpanish.test.ts`). Commit 1.
- [x] T2 (S2) each typecheck error checked against the real data; fix the bug or the type. Commit 2. Frontend typecheck: 0 errors outside test files (16 pre-existing in tests).
- [x] T3 (S3) `userInterfaceStyle` to `dark` (test `tests/__tests__/appConfigTheme.test.ts`); native setting, needs a new dev build; maintainer confirms on device. Commit 3.

## Log

- L1: Maintainer, 2026-10-25, verbatim: "okey empezemos por los de frontend como dices, es facil y rapdio luego vemos en a cual trabajamos. si queres rcea un woktree donde vamos a etsar trabajado todas estas que comentaste, el woktree me gusria atacar Frontend  y lo de quitar el modulo de wallet de todos lados del proyecto ya que es legacy."
- L2: Reused the existing `remove-legacy-wallet` worktree (plan `odd/tasks/remove-legacy-wallet.md` on `feat/remove-legacy-wallet`) instead of a second one; this branch starts from `origin/main` 5cd0902. BL20 survey: only `orders:prepare.alreadyGeneratedTitle` and `alreadyGeneratedDesc` are missing from both locales; the other three `defaultValue`s duplicate existing keys.
- L3: BL19 findings. Real bug: the dispute report wizard never showed its step indicator (`WizardSteps` returns `null` without `steps`); it now gets `disputes:steps.*`. Type-only (runtime data was right): `RawOrder` lacked the `shipments` the query selects; `OrderCard` and the orders list typed `EnrichedOrder` while they receive `CompatEnrichedOrder` with `items`; the `manage-payment-methods` registry said `clientSecret` while the function returns `setupIntent` (the add-card flow now refuses an incomplete config instead of opening the sheet); the sell preview lacked the four nullable publication columns (null until publish).
- L4: Finding outside scope, issue #27: the add-card sheet hardcodes `googlePay.testEnv: true` and Spanish `Alert` strings (`PaymentMethodPickerModal.tsx`).
- L5: Maintainer, 2026-10-25, verbatim: "okey master a ver, primero antes de push y pr,  arregla los textos de report id, digo es cambio ultra minimo , no conviene dejarlo asu, asi que cambialo rapido, y metelo junto con todo." Done: `report/[id].tsx` subtitle uses `disputes:titleSeller` (same text) and the new `disputes:orderReference` instead of `'Impugnar Retorno'` and `` `Orden #...` ``.
