# Design: SAT Tax Withholding (Retención ISR + IVA)

## Technical Approach

Fix at the source: modify `fn_create_order_from_payment` to subtract SAT withholding (ISR 1% + IVA 8%) from `net_payout`. Five downstream SQL functions read `SUM(net_payout)` from `order_items` and inherit the corrected value automatically. Add nullable columns to `order_items`, `wallet_transactions`, and `system_settings` to store withholding amounts and configurable percentages. Update the Edge Function metadata and both frontend surfaces (mobile detail sheet, admin ledger table).

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Column nullability | NULL for new cols on existing rows | Avoids table locks on large `order_items`/`wallet_transactions` during migration. NULL semantically means "pre-migration order" |
| Default percentages | ISR 0.01, IVA 0.08 in `system_settings` | Hardcoded defaults at migration time; future legal changes require only an UPDATE, no deploy |
| Frontend NULL handling | Hide rows entirely when NULL | Pre-migration transactions show no withholding lines (no zeros, no blanks) |
| Edge Function metadata | Decimal strings (like `service_fee`) | Stripe metadata stores strings; SQL uses NUMERIC. No precision loss |
| Downstream propagation | Inherit via `SUM(net_payout)` | 5 functions (`fn_release_shipment_funds`, `fn_complete_shipment_refund`, `fn_cancel_order`, `fn_cancel_shipment`, `fn_resolve_dispute_to_seller`) require zero changes |

## Data Flow

```
Buyer pays
  → create-payment-intent (reads ISR/IVA % from system_settings)
    → Stripe PaymentIntent (metadata: sat_isr_withholding, sat_iva_withholding, sat_total_withholding)
      → Webhook → fn_create_order_from_payment
        → Reads ISR/IVA % from system_settings
        → Calculates v_sat_withholding = price * (isr_pct + iva_pct)
        → v_net_payout = price - commission - v_sat_withholding - shipping
        → INSERT order_items (sat_tax_withholding)
        → INSERT wallet_transactions (tax_withholding)
          → 48h after delivery → fn_release_shipment_funds
            → SUM(net_payout) from order_items (already correct)
            → Credit seller wallet
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/XXXXXX_add_sat_tax_withholding.sql` | Create | Add `sat_tax_withholding` (order_items), `tax_withholding` (wallet_transactions), `isr_withholding_pct`/`iva_withholding_pct` (system_settings) |
| `supabase/queries/orders/fn_create_order_from_payment.sql` | Modify | Add `v_isr_pct`, `v_iva_pct`, `v_sat_withholding` variables; read from `system_settings`; subtract withholding from `net_payout`; INSERT into new columns |
| `supabase/functions/create-payment-intent/index.ts` | Modify | Select `isr_withholding_pct`, `iva_withholding_pct` from `system_settings`; add `sat_isr_withholding`, `sat_iva_withholding`, `sat_total_withholding` to PaymentIntent metadata |
| `apps/frontend/components/features/wallet/TransactionDetailSheet.tsx` | Modify | Add two rows (ISR + IVA) with info-icon tooltips between Commission and Shipping; hide when NULL |
| `apps/admin-web/src/components/features/users/UserTransactionsTable.tsx` | Modify | Add "Retención SAT" column after "Comisión Selene" with expandable ISR/IVA breakdown; show "—" for NULL |
| `apps/frontend/core/i18n/locales/es/wallet.json` | Modify | Add `taxWithholding`, `taxWithholdingISR`, `taxWithholdingIVA`, `taxWithholdingTooltip` keys |
| `apps/frontend/core/i18n/locales/en/wallet.json` | Modify | Add corresponding English keys |
| `packages/types/src/database.types.ts` | Modify | Regenerated via `bun db:types` — adds new column types |

## Interfaces / Contracts

### SQL Variable Additions (fn_create_order_from_payment)

```sql
v_isr_pct NUMERIC;
v_iva_pct NUMERIC;
v_sat_withholding NUMERIC;
```

### SQL Config Read

```sql
SELECT service_fee_pct, isr_withholding_pct, iva_withholding_pct
  INTO v_commission_pct, v_isr_pct, v_iva_pct
FROM public.system_settings LIMIT 1;
```

### SQL Formula Change (line 62)

```sql
-- BEFORE:
v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - COALESCE(v_prod.shipping_cost, 0);

-- AFTER:
v_sat_withholding := v_prod.price * (v_isr_pct + v_iva_pct);
v_net_payout := v_prod.price - (v_prod.price * v_commission_pct) - v_sat_withholding - COALESCE(v_prod.shipping_cost, 0);
```

### SQL INSERT Changes

```sql
-- order_items INSERT adds:
sat_tax_withholding := v_sat_withholding

-- wallet_transactions INSERT adds:
tax_withholding := v_sat_withholding
```

### Edge Function Metadata Keys

```ts
metadata: {
  // ... existing fields ...
  sat_isr_withholding: (subtotal * isrPct).toString(),
  sat_iva_withholding: (subtotal * ivaPct).toString(),
  sat_total_withholding: (subtotal * (isrPct + ivaPct)).toString(),
}
```

### i18n Keys (es/wallet.json)

```json
{
  "transactionDetail": {
    "taxWithholdingISR": "Retención ISR 1% (acreditable en declaración anual)",
    "taxWithholdingIVA": "Retención IVA 8% (acreditable en declaración anual)",
    "taxWithholdingTooltip": "Esta retención es acreditable en tu declaración anual. No es dinero perdido — el SAT te lo descuenta al declarar."
  }
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `fn_create_order_from_payment` formula | SQL test: $1,000 product → sat_tax_withholding=$90, net_payout=$720 |
| Unit | NULL handling in frontend rows | Render component with `tax_withholding=null` → assert rows absent |
| Integration | End-to-end order creation | Create PaymentIntent via Edge Function → verify metadata → process webhook → assert order_items and wallet_transactions have correct withholding |
| Integration | Downstream inheritance | Trigger `fn_release_shipment_funds` on order with withholding → assert wallet credit equals net_payout (not gross) |
| Regression | Existing orders | Query pre-migration order_items → assert `sat_tax_withholding IS NULL` and UI shows no withholding rows |

## Migration / Rollout

1. Deploy migration (nullable columns, harmless to running code)
2. Update `fn_create_order_from_payment` (new orders get correct withholding)
3. Redeploy `create-payment-intent` Edge Function (metadata populated)
4. Deploy frontend changes (display withholding for new orders)
5. Run `bun db:types` to regenerate TypeScript types

**Rollback**: Revert SQL function formula, redeploy Edge Function without metadata fields, remove frontend rows/columns. Nullable columns can remain; no data corruption. Existing orders created during rollout will have NULL in new columns — handled gracefully.

## Open Questions

- None. All technical decisions are resolved; percentages (1% ISR + 8% IVA) confirmed by legal per proposal.
