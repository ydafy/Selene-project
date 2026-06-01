# Tasks: SAT Tax Withholding (Retención ISR + IVA)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~170 (hand-written) + ~20 (auto-generated types) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Full implementation: schema + logic + UI | Single PR to main | All phases fit under 400 lines |

## Phase 1: Schema & Types (Foundation)

- [x] 1.1 Create migration `supabase/migrations/20260601030309_add_sat_tax_withholding.sql` with: `ALTER TABLE order_items ADD COLUMN sat_tax_withholding NUMERIC`, `ALTER TABLE wallet_transactions ADD COLUMN tax_withholding NUMERIC`, `ALTER TABLE system_settings ADD COLUMN isr_withholding_pct NUMERIC DEFAULT 0.01`, `ALTER TABLE system_settings ADD COLUMN iva_withholding_pct NUMERIC DEFAULT 0.08`, and `UPDATE system_settings SET isr_withholding_pct = COALESCE(isr_withholding_pct, 0.01), iva_withholding_pct = COALESCE(iva_withholding_pct, 0.08) WHERE id = 1`
- [x] 1.2 Run `bun db:types` to regenerate `packages/types/src/database.types.ts` — verify `sat_tax_withholding` appears in `order_items.Row/Insert/Update` and `tax_withholding` appears in `wallet_transactions.Row/Insert/Update`, and `isr_withholding_pct`/`iva_withholding_pct` in `system_settings`

## Phase 2: Core Logic (Backend)

- [x] 2.1 Modify `supabase/queries/orders/fn_create_order_from_payment.sql`: add `v_isr_pct NUMERIC`, `v_iva_pct NUMERIC`, `v_sat_withholding NUMERIC` to DECLARE block; change config SELECT to `SELECT service_fee_pct, isr_withholding_pct, iva_withholding_pct INTO v_commission_pct, v_isr_pct, v_iva_pct FROM public.system_settings LIMIT 1`; add formula `v_sat_withholding := v_prod.price * (v_isr_pct + v_iva_pct)` before line 62; change line 62 to `v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - v_sat_withholding - COALESCE(v_prod.shipping_cost, 0)`; add `sat_tax_withholding` to `order_items` INSERT; add `tax_withholding` to `wallet_transactions` INSERT
- [x] 2.2 Modify `supabase/functions/create-payment-intent/index.ts`: add `isr_withholding_pct, iva_withholding_pct` to the `system_settings` SELECT (line 93); compute `satIsrWithholding`, `satIvaWithholding`, `satTotalWithholding` from `subtotalFromDB * pct`; add `sat_isr_withholding`, `sat_iva_withholding`, `sat_total_withholding` as decimal string values to the PaymentIntent `metadata` object (after line 188)

## Phase 3: Frontend Display

- [x] 3.1 Add i18n keys to `apps/frontend/core/i18n/locales/es/wallet.json` under `transactionDetail`: `taxWithholdingISR`, `taxWithholdingIVA`, `taxWithholdingTooltip`. Add matching English keys to `apps/frontend/core/i18n/locales/en/wallet.json`
- [x] 3.2 Modify `apps/frontend/components/features/wallet/TransactionDetailSheet.tsx`: add two `renderRow` calls between Commission and Shipping rows for ISR and IVA withholding using `transaction.tax_withholding` (split into ISR 1/9 and IVA 8/9 proportions); add `TouchableOpacity` info icons with tooltip text from i18n; rows hidden automatically when `tax_withholding` is NULL (renderRow already returns null for null amounts)
- [x] 3.3 Modify `apps/admin-web/src/components/features/users/UserTransactionsTable.tsx`: add "Retención SAT" column after "Comisión Selene" (line 125); cell shows `-$X` with `text-fire` color when `tax_withholding > 0`, em dash "—" when NULL

## Phase 4: Verification

- [x] 4.1 Verify formula correctness: run `fn_create_order_from_payment` with $1,000 product → assert `sat_tax_withholding = $90`, `net_payout = $720` (9% commission, 9% withholding, $100 shipping). Verify NULL handling: query pre-migration `order_items` → assert `sat_tax_withholding IS NULL`. Verify UI: render `TransactionDetailSheet` with `tax_withholding=null` → assert no ISR/IVA rows appear

## Implementation Order

Phase 1 → Phase 2 → Phase 3 → Phase 4. Migration must run before the SQL function change. Types must be regenerated before frontend code references new columns. Edge Function and SQL function changes are independent of each other but both depend on Phase 1.
