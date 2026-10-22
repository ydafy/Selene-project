# Purchase intent

Let buyers see listings still in verification, register purchase intent ("Avísame"), and let sellers learn about demand. Only Connect-ready sellers with VERIFIED listings can be paid.
Plan source: Engram `selene/purchase-intent-plan` (obs #2534). Branch `feat/purchase-intent`.

## Specs

- S1 Visibility: "la tabla de estados visibles (PENDING_VERIFICATION e IN_REVIEW visibles, REJECTED oculto, solo VERIFIED se compra)". Plan: "products_select_public adds PENDING_VERIFICATION, IN_REVIEW; REJECTED/HIDDEN/RESERVED/IN_DISPUTE hidden; only VERIFIED purchasable; badges; audit products columns before RLS change".
- S2 "que home y búsqueda no se tocan". Plan: "home \"recientes verificados\" + search untouched".
- S3 Connect gate: "create-connect-payment must require profiles_private.stripe_onboarding_status='complete', today only checks stripe_account_id = real money-flow bug".
- S4 "read-only \"accepts payments\" boolean; pre-checks product/cart/checkout; i18n hardcoded English error in usePaymentProcess".
- S5 "profile banner when >=1 listing and Connect incomplete".
- S6 "el botón \"Avísame\"". Plan: "purchase intent \"Avísame\" via RPC with reason".
- S7 "los avisos agrupados al vendedor". Plan: "aggregated deduped seller notice".
- S8 Plan: "notify buyers when purchasable, product.approved Connect CTA".
- S9 "favoritos va como bloque propio (avisarle al vendedor que su producto genera interés y arreglar el copy de favoritos que promete una alerta que no existe)". Plan: "favorites -> seller notification (\"tu producto está generando interés\") ... reusing the aggregated notice mechanism, and fix favorites copy promising a nonexistent approval alert (product.json:76)".
- S10 Plan: "B4 email".

## Tasks

- [x] T1 S3: server Connect gate in `create-connect-payment` (require `stripe_onboarding_status = 'complete'`). Route: inline, test-first. Risk: item 2/money flow, own commit. Evidence: commit `fix(payments): require complete Connect onboarding before checkout`; unit RED->GREEN, bun test 2548/0, deno check no new errors, local stack + Bruno 11/11.
- [x] T2a S4: read-only "accepts payments" boolean as RPC `fn_product_seller_payment_readiness(uuid[])` (anon/authenticated/service_role, PUBLIC revoked). Route: inline, test-first. Risk: item 2 (SECURITY DEFINER grant), own commit. Evidence: commit `feat(products): expose whether a listing's seller accepts payments`; structural RED->GREEN, db reset, Bun.sql rollback check (pending/complete/null status/banned/no account), Bruno 14/14.
- [x] T2b S4: pre-checks in product page, cart add and checkout using T2a; i18n the hardcoded `SELLER_NOT_ONBOARDED` error in `usePaymentProcess`. Route: worker (context backstop). Evidence: commit `feat(checkout): warn buyers before paying when a seller cannot receive payments`; RED (module missing) -> GREEN, bun test 2569/0, typecheck clean in touched files, eslint clean.
- [ ] T3 S5: profile banner for sellers with listings and incomplete Connect. Route: inline.
- [ ] T4 S1-S2: audit product queries and exposed columns, RLS migration, status badges; pin home/search to VERIFIED. Route: inline, local stack + Bruno. Risk: item 2 (RLS), own commit.
- [ ] T5 S6-S7: "Avísame" RPC with reason + aggregated deduped seller notice. Route: inline, local stack.
- [ ] T6 S8: notify interested buyers when purchasable; Connect CTA on product.approved. Route: inline.
- [ ] T7 S9: favorites interest notice to seller via S7 mechanism + fix favorites copy. Route: inline.
- [ ] T8 S10: email channel. Route: decide when reached.

## Log

- L1 (maintainer, verbatim): "Master, arrancamos el feature de intención de compra en este worktree (rama feat/purchase-intent). Ya está todo planeado en la sesión anterior: buscá en Engram el topic \"selene/purchase-intent-plan\" (mem_search + mem_get_observation) y leé las decisiones que tomamos: la tabla de estados visibles (PENDING_VERIFICATION e IN_REVIEW visibles, REJECTED oculto, solo VERIFIED se compra), que home y búsqueda no se tocan, el gate de Connect, el botón \"Avísame\", los avisos agrupados al vendedor y que favoritos va como bloque propio (avisarle al vendedor que su producto genera interés y arreglar el copy de favoritos que promete una alerta que no existe). Dime que opinas"
- L2 (maintainer): "me gusta master, dale si no tienes mas dudas o coas que me quieras preguntar." Approved order: T1 first.
- L3 (evidence): `stripe-webhooks/index.ts:1063-1088` writes `stripe_onboarding_status` from `normalizeAccountStatus` on every `account.updated`, including downgrades to `pending`/`rejected`, so the column is a valid gate source. `fn_reserve_products.sql:74-82` reserves only `VERIFIED` products, so opening visibility (T4) does not make non-verified listings purchasable server-side.
- L5 (T1 verification): seed seller now has `acct_local_seller_pending` with `pending` onboarding; Bruno `checkout-seller-onboarding-pending` returns 400 SELLER_NOT_ONBOARDED and the listing is VERIFIED again. Old code was not replayed against the stack because it would create a real sandbox PaymentIntent.
- L6 (T2a): `profiles_private.status` is nullable, so the RPC uses `IS DISTINCT FROM 'suspended'/'banned'` to match `fn_reserve_products`. `get_advisors` not run: the migration is not applied remotely yet, so remote advisors cannot see it; run after the maintainer applies it.
- L7 (T2b follow-ups): checkout still mounts `usePaymentProcess` (reserve + create-connect-payment) while the blocked-seller ErrorState shows; the server refuses and releases, so it is wasteful but safe. `product:errors.verificationFailed` is referenced in `useProductCart.ts` but missing from locales (pre-existing). Screen/cart tests are source contracts, not rendered behavior.
- L8 (slice 1 = T1, T2a, T2b: d0967db, 1e49e81, 349bf00, 868 lines). Native review lineage review-80471c2792af5387 (risk + reliability) approved and acknowledged. Advisory findings, later work: R1-001 suggestion on the RPC body; reliability warnings on cwd-dependent and source-text wiring tests; legacy sellers with a Connect account and NULL onboarding status are blocked by the gate. Remote check (read-only): 11 sellers with a Connect account, all `complete`, none NULL, so the gate blocks no current seller. Slice boundary recorded here; T3 starts slice 2.
- L4 (risk for T4): home/search currently rely on RLS to hide non-verified listings; every product query must filter `status` explicitly before the policy opens.
