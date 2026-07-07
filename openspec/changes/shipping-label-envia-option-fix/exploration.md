## Exploration: shipping-label-envia-option-fix

### Current State
Seller label generation fails after checkout with Envia code `1170` (`Invalid Option` / `Invalid operation`) because the label request is not tied to the quoted Envia option.

Current flow:
1. **Quote/listing** — `useSellDetailsForm` calls `get-shipping-quote` using origin ZIP, package preset, price, and default destination ZIP `06500`. The function returns `{ carrier, service, price }[]`, but the frontend only persists `shipping_cost` on `products`.
2. **Checkout/order/shipment** — `create-connect-payment` reads `products.shipping_cost`, creates per-seller Stripe PaymentIntents, and stores shipping cents in metadata. `fn_create_shipment_from_payment` creates `orders`, `shipments`, and `order_items`, but persists no Envia carrier/service/print option on `shipments`.
3. **Seller generates label** — `prepare/[id].tsx` calls `useOrderActions.generateLabel` with `shipmentId`, `originAddress`, and evidence only. `generate-shipping-label` recomputes package dimensions, then hardcodes `shipment: { carrier: 'paquetexpress', service: 'ground', type: 1 }` and `settings: { printFormat: 'PDF', printSize: 'STOCK_4X6' }`.
4. **Persistence/tracking** — on Envia success, `generate-shipping-label` updates `shipments.status`, `tracking_number`, `label_url`, `carrier`, `envia_shipment_id`, `origin_address`, and currently also attempts `shipping_evidence`.

Selected Envia option capture:
- Captured transiently in `get-shipping-quote` response as `ShippingOption.service`.
- Not persisted in `products`, `orders`, `shipments`, Stripe metadata, or frontend checkout state.
- `shipments.carrier` exists, but it is only written after label generation and cannot drive label generation.
- `shipments.service`, `shipments.print_format`, `shipments.print_size`, and `shipments.shipping_evidence` are absent from generated DB types.

### Affected Areas
- `supabase/functions/get-shipping-quote/index.ts` — source of Envia carrier/service rates, currently single-origin/seller estimate and not persisted.
- `apps/frontend/core/hooks/useSellDetailsForm.ts` — consumes quote but only stores the first rate price as product `shipping_cost`.
- `apps/frontend/core/hooks/usePublishProduct.ts` — persists listing shipping fields; no selected carrier/service field exists.
- `supabase/functions/create-connect-payment/index.ts` — reads product shipping cost and writes Stripe metadata; no option metadata is passed.
- `supabase/queries/orders/fn_create_shipment_from_payment.sql` — creates shipments after checkout; no option columns are inserted.
- `apps/frontend/app/profile/orders/prepare/[id].tsx` and `apps/frontend/core/hooks/useOrderActions.ts` — label generation contract does not carry carrier/service/print options.
- `supabase/functions/generate-shipping-label/index.ts` — hardcoded Envia option likely triggers code 1170; also references absent `shipping_evidence`.
- `packages/types/src/database.types.ts` — verified `shipments` has `carrier`, `tracking_number`, `label_url`, `envia_shipment_id`, `origin_address`; it lacks `service`, print option columns, and `shipping_evidence`.
- `packages/types/src/index.ts` — `ShippingOption` includes `carrier` and `service`; `generate-shipping-label` payload does not.

### Approaches
1. **Persist selected Envia option on shipment** — Add shipment-level columns for selected `carrier`, `service`, and optionally print settings; carry values from quote/listing or checkout into shipment creation, then generate labels from persisted values.
   - Pros: deterministic, auditable, supports tracking and retries, fixes root cause instead of guessing.
   - Cons: needs manual SQL + regenerated DB types; existing paid shipments need a fallback or repair path.
   - Effort: Medium.

2. **Re-rate immediately before label generation** — At label time, call Envia `/ship/rate/` with the real origin/destination/package and select a valid returned option, then call `/ship/generate/` with that exact carrier/service.
   - Pros: avoids persisting stale quote choices; minimal schema for carrier/service may be deferred.
   - Cons: final seller economics may differ from listing-time `shipping_cost`; extra Envia dependency during seller action; still needs a place to persist selected service for audit/retry if successful.
   - Effort: Medium.

3. **Payload-only quick fix** — Extend the label payload to accept carrier/service and pass a frontend-selected value at prepare time.
   - Pros: smallest code path if no schema change is allowed.
   - Cons: no durable source of truth, easy to tamper with unless revalidated server-side, poor retry/audit story.
   - Effort: Low.

### Recommendation
Use Approach 1 with a narrow fallback from Approach 2 for legacy shipments: persist an Envia label option at shipment scope, generate labels only with persisted or freshly re-rated valid `{ carrier, service }`, and update `generate-shipping-label` to stop hardcoding `paquetexpress/ground` and fixed print options unless explicitly validated. Also resolve the `shipping_evidence` schema mismatch before expecting DB persistence to succeed after Envia accepts the request.

### DB / Schema Implications
- Minimal durable fix likely needs `shipments.service` (or `envia_service`) and possibly `shipments.print_format` / `shipments.print_size` if Envia requires exact print option compatibility.
- `shipments.shipping_evidence` is referenced by `generate-shipping-label` but absent from generated types; either add the column or remove/redirect that persistence to an existing evidence store.
- If adding public-table columns, user applies SQL manually in Supabase Dashboard; after SQL, run `bun run db:types` to update `packages/types/src/database.types.ts` and use aliases from `packages/types/src/index.ts`.
- No payout-release schema should be touched in this change.

### Testing Strategy
Strict TDD with Bun:
- RED: Add unit tests for a pure Envia payload builder/helper proving it uses selected/persisted `carrier` and `service` and rejects missing options instead of defaulting to hardcoded values.
- RED: Add a regression test for Envia error handling/logging when code `1170` is returned.
- RED: Add contract/type tests for `generate-shipping-label` payload and/or shipment option persistence fields after schema/type updates.
- GREEN: Implement smallest helper/function changes, then run focused `bun test supabase/functions/generate-shipping-label/...` or the exact new test file.
- VERIFY: Run broader `bun test` only after focused tests pass; run relevant TypeScript typecheck if generated types/contracts change.

### Risks
- Envia may require service identifiers exactly as returned by rate responses; display labels or guessed names can still fail with 1170.
- Existing paid shipments created before option persistence may not have selected carrier/service; they need controlled re-rating or a one-off repair path.
- Adding `shipping_evidence` without matching RLS/storage policy decisions can broaden scope; keep it only if necessary for label persistence.
- Checkout economics currently use listing `shipping_cost`; re-rating at label time can reveal cost drift that this narrow fix may not fully solve.

### Ready for Proposal
Yes — proceed to proposal with scope limited to Envia option selection/persistence and label generation. Explicitly exclude payout release and broader checkout economics redesign.
