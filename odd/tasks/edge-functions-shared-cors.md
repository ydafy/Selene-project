# Edge Functions: one shared CORS module (#336)

Item 2 of roadmap #335. Replaces the wildcard CORS header each Edge Function copies with one module in `supabase/functions/_shared/` that answers only admin-web origins. Branch `feat/edge-functions-shared-cors`.

## Specs

- **S1.** "Alcance: solo CORS. Un único módulo en _shared/, que permita solo los orígenes del admin-web"
- **S2.** "y que no ponga CORS en las llamadas entre servidores (crons, webhooks)."
- **S3.** "Las API keys nuevas son el #337 y NO van en esta sesión."
- **S4.** "Antes de decidir la lista de orígenes, revisá quién llama a cada función desde el navegador (admin-web y, si existe, la versión web de la app de Expo) y avisame si alguna llamada se rompería."
- **S5.** From #336, Done when: "CORS lives in one module, no function sets its own CORS header, and the Bruno collection passes." Scope: "Update `supabase/functions/AGENTS.md`."
- **S6.** "Verificá como dice supabase/functions/AGENTS.md: Bruno completo después de supabase db reset. Los escenarios del sandbox con stripe:listen, porque el cambio toca funciones de plata. bun run test:e2e:local del admin-web, porque llama a estas funciones desde el navegador."
- **S7.** "Cuando todo pase: push, PR con "Closes #336" y merge con el CI en verde. No despliegues sin preguntarme."
- **S8.** Decisions (L2): only the 13 functions admin-web calls get the module; Expo web (dev only, `localhost:8081`) is allowed to break; origins come from the `ADMIN_WEB_ORIGINS` variable and a missing list fails closed (no CORS headers).

## Tasks

- [x] T1 (S1, S8): `_shared/cors.ts` with unit tests: origin list parsing, preflight, headers on allowed origins only, `Vary: Origin`. Inline.
- [x] T2 (S1, S5, S8): the 13 admin-web functions serve with `serveAdminWeb` (keeps the handler bodies' indentation), drop their own CORS and `OPTIONS` branches and the handler-test CORS assertions; guard `_shared/__tests__/cors-wiring.test.ts` derives the list from admin-web string literals; `sentry-wiring` accepts `serveAdminWeb`. Inline.
- [x] T3 (S2, S5, S8): remove CORS and `OPTIONS` branches from the 16 functions no browser calls (Expo-only, webhooks, `connect-onboarding-return`, `reconcile-connect-payments`). Worker `mwa0uis1-2-elau`; no method guard needed (every `OPTIONS` gets a 4xx before any work). Commit `de7effd0`.
- [x] T4 (S5): `supabase/functions/AGENTS.md`, `docs/go-live.md` (the `ADMIN_WEB_ORIGINS` secret).
- [ ] T5 (S6): unit suite, lint, typecheck, `deno check`; `supabase db reset` + full Bruno; sandbox scenarios with `stripe:listen`; `test:e2e:local`; independent verify (security, risk item 2).
- [ ] T6 (S7): push, PR with `Closes #336`, merge with CI green. No deploy.

## Log

- **L1.** User request (2026-11-09): "Sigamos con el roadmap #335, ítem 2: #336, un módulo CORS compartido para las Edge Functions. Trabajá en este worktree (C:/dev/School-portal-worktrees/bruno-money-functions), en una rama nueva desde origin/main (la rama vieja ya está mergeada). Contexto: leé #336, el #311 con sus comentarios y el roadmap #335. En Engram está el topic roadmap/edge-functions-auth-stripe. El ítem 1 (#332) ya está hecho: las funciones de plata tienen requests de Bruno, y además hay escenarios contra el sandbox de Stripe que solo corren si los pedís a propósito (opt-in). Cómo se corren está en supabase/functions/AGENTS.md, "Bruno collection". Alcance: solo CORS. Un único módulo en _shared/, que permita solo los orígenes del admin-web y que no ponga CORS en las llamadas entre servidores (crons, webhooks). Las API keys nuevas son el #337 y NO van en esta sesión. Antes de decidir la lista de orígenes, revisá quién llama a cada función desde el navegador (admin-web y, si existe, la versión web de la app de Expo) y avisame si alguna llamada se rompería. Verificá como dice supabase/functions/AGENTS.md: Bruno completo después de supabase db reset. Los escenarios del sandbox con stripe:listen, porque el cambio toca funciones de plata. bun run test:e2e:local del admin-web, porque llama a estas funciones desde el navegador. Cuando todo pase: push, PR con "Closes #336" y merge con el CI en verde. No despliegues sin preguntarme."
- **L2.** Caller map and decisions (2026-11-09). admin-web calls 13 functions: `list-shipment-refund-problems`, `resolve-shipment-refund`, `list-shipment-late-carrier-activity`, `acknowledge-shipment-late-carrier-activity`, `list-shipment-label-reconciliations`, `resolve-shipment-label-reconciliation`, `list-shipment-operation-reviews`, `resolve-shipment-operation-review`, `resolve-dispute`, `get-connect-payout-release-queue`, `release-connect-payout`, `get-seller-onboarding`, `refresh-connect-account-status`. The native Expo app is not subject to CORS. Expo web (`expo start --web`, `http://localhost:8081`) has no deploy; it would break on every call. `connect-onboarding-return` is reached by top-level navigation (Stripe Account Link), not by fetch. `reconcile-connect-payments` has no browser caller. Maintainer answers: "Dejar que se rompa", "Solo las 13 del admin-web", "Variable ADMIN_WEB_ORIGINS".
- **L3.** Wrapping inline handlers as `withSentry('x', withAdminWebCors(async ...))` made Prettier reindent whole bodies (1,600 changed lines, 1,046 in `release-connect-payout`). Replaced by `serveAdminWeb(withSentry(...))`, a drop-in for `Deno.serve`: 44 insertions, 219 deletions for T2. Removing an `OPTIONS` branch from a function no browser calls may let an `OPTIONS` request reach work; T3 adds a 405 method guard only where that happens.
