# Proposal: SAT Tax Withholding (Retención ISR + IVA)

## Intent

Selene operates under Mexico's **Régimen de Plataformas Tecnológicas** (Art. 113-A LISR). By law, the platform must withhold 9% of every seller's gross product value (1% ISR + 8% IVA) and remit it to the SAT. Currently, the `net_payout` formula in `fn_create_order_from_payment` is **missing** this withholding, meaning the platform absorbs the tax burden on every transaction. This is a legal compliance gap that causes direct financial loss.

## Scope

### In Scope
- Add `sat_tax_withholding` column to `order_items` (stores the withheld amount per item)
- Add `tax_withholding` column to `wallet_transactions` (audit trail for sellers)
- Add `isr_withholding_pct` and `iva_withholding_pct` columns to `system_settings` (configurable percentages, defaults: 0.01 and 0.08)
- Fix the `net_payout` formula in `fn_create_order_from_payment` to subtract SAT withholding
- Update `create-payment-intent` Edge Function to include `sat_withholding` in PaymentIntent metadata for Stripe audit trail
- Update mobile `TransactionDetailSheet` to display "Retención SAT" row
- Update admin `UserTransactionsTable` to display "Retención SAT" column
- Regenerate `database.types.ts` after migration

### Out of Scope
- **GAP-4** (confirmed correct): Refund logic reads `net_payout` from `order_items` — fixing the source formula propagates automatically to all 5 downstream functions
- **GAP-5** (IVA on commission): Requires accountant confirmation. Deferred.
- **GAP-6** (end-of-year DIOT reporting): Deferred to a future change
- SAT remittance filing (payment to SAT) — separate operational process
- Backfilling existing orders — addressed in rollback plan; existing orders remain as-is

## Capabilities

### New Capabilities
- `sat-tax-withholding`: Configurable ISR + IVA withholding calculation on every seller payout, persisted to `order_items` and `wallet_transactions`, displayed in seller-facing and admin-facing UI

### Modified Capabilities
- `shipments`: The `net_payout` stored in `order_items` now includes SAT withholding deduction. Downstream functions (`fn_release_shipment_funds`, `fn_complete_shipment_refund`, `fn_cancel_order`, `fn_cancel_shipment`, `fn_resolve_dispute_to_seller`) read `net_payout` and inherit the fix automatically — no spec-level behavior change, just corrected values.

## Approach

**Fix at the source, inherit downstream.** The 5 downstream SQL functions all `SUM(net_payout)` from `order_items`. Correcting the formula in `fn_create_order_from_payment` propagates the fix everywhere:

1. **Migration**: Add 3 columns (`order_items.sat_tax_withholding`, `wallet_transactions.tax_withholding`, `system_settings.isr_withholding_pct` + `iva_withholding_pct`) with safe defaults (NULL for new cols on existing rows, 0.01/0.08 for settings)
2. **Formula fix**: Change line 62 in `fn_create_order_from_payment.sql`:
   ```sql
   -- Before:
   v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - COALESCE(v_prod.shipping_cost, 0);
   -- After:
   v_sat_withholding := v_prod.price * (v_isr_pct + v_iva_pct);
   v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - v_sat_withholding - COALESCE(v_prod.shipping_cost, 0);
   ```
3. **Store withholding**: INSERT the `sat_tax_withholding` value into `order_items` and `tax_withholding` into `wallet_transactions`
4. **Edge Function**: `create-payment-intent` reads `system_settings` for ISR/IVA pcts and includes `sat_withholding` in PaymentIntent metadata
5. **Frontend**: Add "Retención SAT" row in mobile detail sheet and column in admin table
6. **Regenerate types**: `bun db:types`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `supabase/queries/orders/fn_create_order_from_payment.sql` | Modified | Core formula fix + new param `p_sat_withholding` |
| `supabase/migrations/XXXXXX_add_sat_tax_withholding.sql` | New | Schema migration for 3 tables |
| `packages/types/src/database.types.ts` | Modified | Regenerated after migration |
| `packages/types/src/index.ts` | Modified | Add `sat_tax_withholding` / `tax_withholding` to exposed types |
| `supabase/functions/create-payment-intent/index.ts` | Modified | Read ISR/IVA pcts, include in metadata |
| `apps/frontend/components/features/wallet/TransactionDetailSheet.tsx` | Modified | Add "Retención SAT" breakdown row |
| `apps/admin-web/src/components/features/users/UserTransactionsTable.tsx` | Modified | Add "Retención SAT" column |
| `apps/frontend/core/i18n/locales/es/wallet.json` | Modified | Add `taxWithholding` translation key |
| `apps/frontend/core/i18n/locales/en/wallet.json` | Modified | Add `taxWithholding` translation key |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing orders have wrong `net_payout` (no withholding) | High | Migration leaves existing rows untouched. New formula only applies to new orders. Existing payouts already disbursed — do NOT recalculate retroactively. |
| Changing `net_payout` changes seller payout amounts | High | This is the INTENDED fix. Sellers receive less per sale (correct by law). Communicate change before deploy. |
| ISR/IVA percentages change (legal update) | Low | Configurable via `system_settings`. No code change needed. |
| Migration locking on large `order_items` table | Medium | Add columns as nullable (no NOT NULL constraint). Backfill is unnecessary — NULL = pre-migration order, handled in app logic. |
| Stripe metadata rounding (cents vs pesos) | Low | Store withholding in metadata as decimal string (like `service_fee`). SQL uses NUMERIC — no precision loss. |

## Rollback Plan

1. **SQL**: Revert `fn_create_order_from_payment` to original formula (remove `v_sat_withholding` variable and subtraction)
2. **Migration**: Columns remain (nullable, harmless). If removal desired: `ALTER TABLE ... DROP COLUMN` in a follow-up migration
3. **Edge Function**: Redeploy `create-payment-intent` without `sat_withholding` metadata field
4. **Frontend**: Remove "Retención SAT" row/column — components already handle `null` gracefully (`renderRow` returns null for null amounts)
5. **Existing orders**: NOT recalculated. They were disbursed at the old (incorrect) `net_payout`. Do NOT attempt retroactive wallet adjustments.

## Dependencies

- Supabase CLI for migration generation and deployment
- `bun db:types` to regenerate TypeScript types after migration
- i18n files for translation keys (es/en)
- Legal confirmation of ISR/IVA percentages (1% + 8%) — assumed correct per Art. 113-A LISR

## Success Criteria

- [ ] `order_items.sat_tax_withholding` is stored for every new order
- [ ] `wallet_transactions.tax_withholding` is stored for every new sale
- [ ] `net_payout = price - (price * commission_pct) - (price * (isr_pct + iva_pct)) - shipping_cost` for new orders
- [ ] 5 downstream SQL functions produce correct values (verified by reading `net_payout`)
- [ ] Mobile TransactionDetailSheet shows "Retención SAT" row with correct amount
- [ ] Admin UserTransactionsTable shows "Retención SAT" column with correct amount
- [ ] `create-payment-intent` metadata includes `sat_withholding` field
- [ ] `system_settings` has `isr_withholding_pct = 0.01` and `iva_withholding_pct = 0.08`
- [ ] No regression: existing orders with NULL withholding display correctly (no deduction shown)