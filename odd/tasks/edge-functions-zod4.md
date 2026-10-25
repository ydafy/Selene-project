# Edge Functions on zod 4 (BL29 + BL28)

Move the 14 Edge Functions that import `https://esm.sh/zod@3.23.8` (GHSA-mrhx-c7xc-m3w5, no 3.x fix, invisible to `bun audit`) to `_shared/zod-runtime.ts` (zod 4.6.7).
Branch `fix/edge-functions-zod4`, worktree `School-portal-worktrees/edge-zod4`. Background: `dependency-security.md` L8-L14, `cross-module-backlog.md` BL28/BL29.

## Specs

- S1: "migrar las 14 Edge Functions que importan https://esm.sh/zod@3.23.8 a _shared/zod-runtime.ts (zod 4.6.7), por GHSA-mrhx-c7xc-m3w5." Functions (BL29): checkout-recovery-worker, confirm-shipment-delivery, create-connect-account, create-payment-intent, create-return-intent, drain-legacy-wallets, generate-return-label, get-connect-earnings, get-shipping-quote, manage-payment-methods, reconcile-connect-payments, resolve-dispute, resolve-shipment-tracking-url, rollback-connect-payment.
- S2: "Un commit por función, con sus tests y su request de Bruno; las de plata (rollback-connect-payment, reconcile-connect-payments, resolve-dispute, create-connect-account, create-payment-intent, manage-payment-methods, drain-legacy-wallets) van cada una en su propio commit."
- S3: "Incluí BL28 (ponerle .max a productIds en create-payment-intent)." BL28: "Add a `.max` matching `create-connect-payment` (50)".
- S4: "Cerrá con un test que falle si alguna Edge Function vuelve a importar zod desde una URL."
- S5: "Ojo: zod 4 tiene .uuid() más estricto y cambia la forma de los errores, así que revisá qué esperan los clientes de cada función."

## Tasks

Route: inline. Each function: request schema moved to `<fn>/request-schema.ts` on `../_shared/zod-runtime.ts`, a bun test of that schema, a Bruno request under `bruno/functions/`, one commit.

- [x] T1 (S1, S2, S5): resolve-shipment-tracking-url (76505d8)
- [x] T2 (S1, S2, S5): get-shipping-quote (1a51a36, L5)
- [x] T3 (S1, S2, S5): confirm-shipment-delivery (ca46d39)
- [x] T4 (S1, S2, S5): create-return-intent (ba08159)
- [x] T5 (S1, S2, S5): generate-return-label (1210003)
- [x] T6 (S1, S2, S5): get-connect-earnings (126c41b)
- [x] T7 (S1, S2, S5): checkout-recovery-worker (b86274c)
T8-T14 route: `gentle-ai-worker` (parent context backstop); the parent reviews each diff and commits per function.

- [x] T8 (S1, S2, S5): rollback-connect-payment (money) (de19c7a)
- [x] T9 (S1, S2, S5): reconcile-connect-payments (money) (7f8c912)
- [x] T10 (S1, S2, S5): resolve-dispute (money) (de27952)
- [x] T11 (S1, S2, S5): create-connect-account (money) (b3a76f1)
- [x] T12 (S1, S2, S3, S5): create-payment-intent, with BL28 `.max(50)` (money) (4b8f301, L9)
- [x] T13 (S1, S2, S5): manage-payment-methods (money) (b2eb11f)
- [x] T14 (S1, S2, S5): drain-legacy-wallets (money) (6b5a4ba)
- [x] T15 (S4): guard test against URL zod imports; drop zod 3.23.8 from `supabase/functions/deno.lock`; close BL28/BL29 in the backlog (c4282de)
- [x] T16: verification: `deno check` per function, `bun test`, `functions:serve` + `bun run api:test`

## Log

- L1: "Trabajemos BL29 de odd/tasks/cross-module-backlog.md: migrar las 14 Edge Functions que importan https://esm.sh/zod@3.23.8 a _shared/zod-runtime.ts (zod 4.6.7), por GHSA-mrhx-c7xc-m3w5. Contexto en odd/tasks/dependency-security.md L8-L14 (PR #9 ya mergeado en main). Abrí un worktree nuevo desde main y creá el doc de feature. Un commit por función, con sus tests y su request de Bruno; las de plata (rollback-connect-payment, reconcile-connect-payments, resolve-dispute, create-connect-account, create-payment-intent, manage-payment-methods, drain-legacy-wallets) van cada una en su propio commit. Incluí BL28 (ponerle .max a productIds en create-payment-intent). Cerrá con un test que falle si alguna Edge Function vuelve a importar zod desde una URL. Ojo: zod 4 tiene .uuid() más estricto y cambia la forma de los errores, así que revisá qué esperan los clientes de cada función. si quieres nomas cea el woktree y me meto en esa carpeta o dime si tu puedes trabajar en ese woktree mientras la sesion la abri en main"
- L2: Worktree `C:/dev/School-portal-worktrees/edge-zod4` on `fix/edge-functions-zod4` from `main` 7eb2ae0, registered in the session (worked from the session opened in `main`).
- L3 (S5, client audit): 9 functions return the zod failure as `error: ZodError.message` (JSON of issues): create-connect-account, create-return-intent, drain-legacy-wallets, generate-return-label, get-connect-earnings, manage-payment-methods, reconcile-connect-payments, resolve-dispute, rollback-connect-payment. confirm-shipment-delivery (`INVALID_REQUEST`), get-shipping-quote (`INVALID_INPUT`), resolve-shipment-tracking-url (`INVALID_SHIPMENT_ID`) and create-payment-intent (`INVALID_INPUT`) return fixed codes; checkout-recovery-worker only validates RPC output. No client branches on issue fields, `.issues`, `_errors`, `.format()` or default messages; the only text branch is `PAYMENT_LIMIT_REACHED` (`usePaymentMethods.ts`), not a zod message. Three surfaces show the raw message (useReturnPayment, the return-label screen, the admin dispute toast), so the visible text changes (e.g. "Invalid uuid" -> "Invalid UUID") but nothing depends on it. create-payment-intent has no caller in apps, Bruno or SQL (retirement candidate; S3 keeps it and adds the bound). No test asserted zod text for these 14.
- L4 (S5, stricter `.uuid()`): zod 4 requires RFC 9562 version `[1-8]` and variant `[89ab]` (plus nil/max). Remote project, read-only MCP: 0 non-RFC ids in `orders` (52), `shipments` (61), `disputes` (3), `payment_methods` (14), `products` (154). Seeds and Bruno use `00000000-0000-4000-8000-...` (valid). Pre-cutover non-RFC ids (`openspec/changes/archive/2026-09-05-standardize-checkout-deterministic-uuids/`) are no longer persisted remotely.
- L5 (T2): `get-shipping-quote` read the Envia runtime configuration before parsing the body, and the local `supabase/functions/.env` has no `ENVIA_*`, so locally every request answered 500 `MISSING_SERVER_CONFIG` before zod ran. The body is now validated first: invalid input is a 422 `INVALID_INPUT` on any stack; a valid request on a misconfigured server is still a 500. No client depends on the old precedence (`useShippingQuote` shows the code).
- L6: Pattern per function: the schema moves to `<fn>/request-schema.ts` (checkout-recovery-worker: `charge-evidence-schema.ts`, it validates an RPC result) importing `../_shared/zod-runtime.ts`; `request-schema.test.ts` (RED: module missing) pins accepted input, the zod 4 rejection (`invalid_format`/`format: uuid` for a non-RFC id `11111111-2222-3333-4444-555555555555`, which zod 3.23.8 accepted), custom messages, and that `index.ts` uses that schema. Bruno T1+T2 live: 4/4 pass.
- L7: Bruno T3-T7 live: 8/8 pass (confirm-shipment-delivery 400 `INVALID_REQUEST`, create-return-intent and generate-return-label 400 with the `ID de disputa inválido` issue, get-connect-earnings 400 `too_big`, checkout-recovery-worker 401 for a buyer JWT). Each commit's hook ran `bun test`: 0 fail.
- L8 (T8-T14): `gentle-ai-worker` moved the seven money schemas verbatim (RED "Cannot find module './request-schema.ts'" in all seven; `deno check` clean; `bun test` 3331/0); the parent reviewed every `index.ts` diff (import plus the call site only) and committed each function alone. `drain-legacy-wallets` `.optional().default(false)` keeps an empty body as a real drain, as before (pinned).
- L9 (T12, BL28): `productIds` capped at 50 (unit test: 10,000 invalid ids give one `too_big` on `['productIds']`). Bruno live showed `create-payment-intent` answers 401 `AUTH_REQUIRED` to a valid buyer before validation: `supabaseClient.auth.getUser()` without the JWT on supabase-js 2.39.3 returns "Auth session missing!" (reproduced with a standalone Deno probe). Pre-existing, unrelated to zod, and the function has no caller; logged as backlog BL34 (retire or `getUser(token)`). Its Bruno request pins the 401 and says it must expect 422 once BL34 is fixed.
- L10 (T15, T16): guard `_shared/__tests__/no-url-zod-imports.test.ts` scans every source file under `supabase/functions/` for static, re-export, side-effect and dynamic zod imports from `http(s)://`; RED with the seven money `index.ts` stashed (listed each one), GREEN after. `supabase/functions/deno.lock`: the three zod 3.23.8 entries removed; `deno check --frozen` passes for all 14 entrypoints. Local stack (`supabase start`, `db reset`), `functions:serve` + `bun run api:test`: 108/108 pass. Backlog: BL28 and BL29 marked DONE, BL34 added.
- L11: Rebased on `main` 6a9e3ed (PR #11), which added backlog BL32 and BL33; the `create-payment-intent` auth item is BL34. Commit hashes above are the rebased ones.
