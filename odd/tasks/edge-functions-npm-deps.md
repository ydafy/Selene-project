# Edge Functions on npm: pins (#311 dependency step + #324)

Move every Edge Function import from esm.sh and deno.land to exact `npm:` pins that are root devDependencies, use `Deno.serve`, keep `STRIPE_API_VERSION` in one module, and have the weekly dependency report flag a mismatch with the pinned SDK.
Branch `chore/edge-functions-npm-deps`, worktree `School-portal-worktrees/edge-npm-deps`. Out of scope: shared CORS and the new API keys (rest of #311).

## Specs

- S1: "#311, solo el paso de dependencias: sacar todos los imports de esm.sh y deno.land de supabase/functions (supabase-js, stripe, zod, std) y pasarlos a npm: fijados exactos como devDependencies del package.json raíz, como exige scripts/guards/edge-function-npm-pins.test.ts, más Deno.serve."
- S2: "Leé el comentario que dejé en el #311." The comment: zod is the `npm:zod@4.6.7` pin; every `npm:` specifier equals the exact root devDependency; prefer `npm:` over `jsr:`; "every Edge Function dependency is a root devDependency the weekly report lists."
- S3: "CORS y las API keys nuevas NO van en esta sesión."
- S4: "Después, el #324 completo: STRIPE_API_VERSION en un solo módulo compartido, y un chequeo en el reporte semanal (scripts/ci/dependency-report.ts) que avise si no coincide con la versión de API que trae el SDK fijado."
- S5: "Toca funciones de plata: verificá con el loop local de pagos y Bruno como dice supabase/functions/AGENTS.md."
- S6: "Si el salto de stripe 17 a la última major cambia algo del comportamiento, avisame antes de decidir." Decided in L2: latest SDK and API version (`stripe@23.1.0`, `2026-10-28.endive`).
- S7: "Si el paso 1 sale muy grande, cortá ahí y dejamos el #324 para otra sesión."

## Tasks

Route: inline.

- [x] T1 (S1, S2, S3): supabase-js and std to `npm:` through `_shared/supabase-js.ts`; `Deno.serve`
- [x] T2 (S1, S4, S6): guard against URL imports (RED in T1: 106 URL imports; lands with T2, which removes the last ones); `npm:stripe@23.1.0` through `_shared/stripe/sdk.ts`, `STRIPE_API_VERSION = '2026-10-28.endive'` in `_shared/stripe/api-version.ts`, endive fixes (`payment_method_types` removed) (money, own commit)
- [ ] T3 (S4): dependency report check: `STRIPE_API_VERSION` against the pinned SDK's API version
- [ ] T4 (S5): verification: `deno check`, `bun test`, Bruno, local payments loop

## Log

- L1: "Quiero cerrar el flujo de dependencias de las Edge Functions. Trabajá en un worktree nuevo (docs/worktrees.md). 1. #311, solo el paso de dependencias: sacar todos los imports de esm.sh y deno.land de supabase/functions (supabase-js, stripe, zod, std) y pasarlos a npm: fijados exactos como devDependencies del package.json raíz, como exige scripts/guards/edge-function-npm-pins.test.ts, más Deno.serve. Leé el comentario que dejé en el #311. CORS y las API keys nuevas NO van en esta sesión. 2. Después, el #324 completo: STRIPE_API_VERSION en un solo módulo compartido, y un chequeo en el reporte semanal (scripts/ci/dependency-report.ts) que avise si no coincide con la versión de API que trae el SDK fijado. Toca funciones de plata: verificá con el loop local de pagos y Bruno como dice supabase/functions/AGENTS.md. Si el salto de stripe 17 a la última major cambia algo del comportamiento, avisame antes de decidir. Si el paso 1 sale muy grande, cortá ahí y dejamos el #324 para otra sesión."
- L2: Evidence: functions send `2026-04-22.dahlia` on `esm.sh/stripe@17.0.0`; `stripe@22.1.x` ships `2026-04-22.dahlia`, `stripe@23.1.0` ships `2026-10-28.endive`, whose 2026-09-30 breaking changes remove `payment_method_types` from Setup and Payment Intents (`manage-payment-methods` uses it). Maintainer: "tenemos que estar lo mas actualizados posible ... la deicion la tenemos que basar en 'qe es lo mejor para el proyecto y como podemos mantenernos como que al dia'". Decision: `stripe@23.1.0` with `2026-10-28.endive`; one shared SDK re-export per package so a bump edits one specifier.
- L3: zod already comes only from `npm:zod@4.6.7` (`_shared/zod-runtime.ts`); no esm.sh or deno.land zod import is left.
- L4 (T1): supabase-js pinned at 2.118.0, the version the app workspaces already resolve, so bun keeps one copy; moved from root `dependencies` (a range) to an exact devDependency. `Deno.serve` replaced std `serve` in 42 functions; `reconcile-stripe-fees` uses `Deno.serve` through its runtime guard. Two tests that run an `index.ts` with injected globals now capture the handler from the fake `Deno.serve`. supabase-js 2.118 types made `complete-delivered-shipments` hit TS2589 on a reassigned query builder; it now picks the filtered or unfiltered query with a `const`. `deno check */index.ts`: all pass. `bun test supabase/functions`: 1848 pass, 1 fail (the URL-import guard, waiting on Stripe).
- L5 (T2): `npm:stripe@23.1.0` only in `_shared/stripe/sdk.ts`; `STRIPE_API_VERSION` typed as `Stripe.LatestApiVersion`, so `deno check` fails when the SDK pin moves without it. Endive: `manage-payment-methods` SetupIntent uses `allowed_payment_method_types: ['card']`. SDK 22 no longer reads request options from params: `payouts.retrieve` in `release-connect-payout` and `stripe-webhooks` now passes `{ stripeAccount }` as options (the old two-argument call would have queried the platform account). `create-connect-account` tried Accounts v2 first; on stripe@17 `stripe.v2` did not exist, so every call fell back to v1 Express. On 23 the v2 call would reach Stripe with an invalid payload, so the parent chose to call v1 Express directly (today's behavior, manual payouts kept) and drop the `fallback_reason` metadata nobody reads. `setup_intent.succeeded` logs a WARN and saves nothing for a non-card method instead of a failing insert. Deno resolves stripe's `deno` export to the worker build (SubtleCrypto), so `constructEventAsync` needs no crypto provider; webhook tolerance and the retry classification of `StripeConnectionError` are unchanged for our calls. `deno.lock` drops every remote entry. `deno check --frozen */index.ts`: 43 pass. `bun test supabase/functions`: 1849 pass, 0 fail.
