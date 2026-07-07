import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const readSql = (relativePath: string) =>
  readFileSync(join(root, relativePath), 'utf8').replace(/\s+/g, ' ');

describe('Connect money-flow SQL guards', () => {
  it('Connect shipment RPC parses product_ids JSON string metadata', () => {
    const sql = readSql(
      'supabase/queries/orders/fn_create_shipment_from_payment.sql',
    );

    expect(sql).toContain(
      "jsonb_array_elements_text((p_metadata ->> 'product_ids')::jsonb)",
    );
  });

  it('Connect shipment RPC casts seller and buyer metadata to UUID', () => {
    const sql = readSql(
      'supabase/queries/orders/fn_create_shipment_from_payment.sql',
    );

    expect(sql).toContain("v_seller_id := (p_metadata ->> 'seller_id')::UUID");
    expect(sql).toContain("v_buyer_id := (p_metadata ->> 'buyer_id')::UUID");
  });

  it('Connect shipment RPC creates orders with total amount and address snapshot', () => {
    const sql = readSql(
      'supabase/queries/orders/fn_create_shipment_from_payment.sql',
    );

    expect(sql).toContain('SELECT to_jsonb(a.*) INTO v_addr_snapshot');
    expect(sql).toContain('total_amount, shipping_address');
    expect(sql).toContain('v_order_amount, v_addr_snapshot');
  });

  it('Connect shipment RPC persists estimated seller shipping deduction from metadata', () => {
    const sql = readSql(
      'supabase/queries/orders/fn_create_shipment_from_payment.sql',
    );
    const shipmentInsertStart = sql.indexOf('INSERT INTO public.shipments');
    const shipmentInsertEnd = sql.indexOf('RETURNING id INTO v_shipment_id');
    const shipmentInsert = sql.slice(shipmentInsertStart, shipmentInsertEnd);

    expect(sql).toContain(
      "(p_metadata ->> 'seller_shipping_deduction_cents')::BIGINT",
    );
    expect(sql).toContain("(p_metadata ->> 'shipping_cents')::BIGINT");
    expect(sql.indexOf('seller_shipping_deduction_cents')).toBeLessThan(
      sql.indexOf('shipping_cents'),
    );
    expect(shipmentInsert).toContain('shipping_cost');
    expect(shipmentInsert).toContain('v_seller_shipping_deduction_cents');
  });

  it('Connect shipment RPC does not use stale products reserved_by column', () => {
    const sql = readSql(
      'supabase/queries/orders/fn_create_shipment_from_payment.sql',
    );

    expect(sql).not.toContain('reserved_by');
    expect(sql).toContain("p.status = 'RESERVED'");
    expect(sql).toContain("SET status = 'SOLD', updated_at = now()");
  });

  it('Connect PaymentIntent metadata includes buyer address id', () => {
    // After the single-modal Phase 3 rewrite, `address_id` lives in PI metadata
    // built by the pure `single-payment-builder.ts` (index.ts is thin Stripe/
    // Supabase wiring). Guard BOTH layers: index.ts validates + forwards the
    // address id, the builder emits the `address_id` metadata key.
    const indexSource = readSql(
      'supabase/functions/create-connect-payment/index.ts',
    );
    const builderSource = readSql(
      'supabase/functions/create-connect-payment/single-payment-builder.ts',
    );

    expect(indexSource).toContain('addressId: z.string().uuid(),');
    // After the single-modal Phase 3 rewrite, index.ts validates the raw body
    // via `normalizedRequest` (the zod-parsed + normalized payload) before
    // forwarding it to the builder. Guard the normalized forwarding path, not
    // the stale `parsedBody` literal.
    expect(indexSource).toContain('addressId: normalizedRequest.addressId');
    expect(builderSource).toContain('address_id: addressId');
  });

  it('Connect PaymentIntent metadata includes the estimated seller shipping deduction', () => {
    // After the single-modal Phase 3 rewrite, the per-seller estimated shipping
    // deduction is computed via `calculateEstimatedSellerShippingDeductionCents`
    // and carried as `shippingCents` in the per-seller allocation rows, which
    // travel chunked inside `allocation_json` PI metadata — NOT as a stale
    // top-level `seller_shipping_deduction_cents` key on a `moneyFlow` object.
    // Guard the new SCT contract end-to-end (not the legacy literal).
    const indexSource = readSql(
      'supabase/functions/create-connect-payment/index.ts',
    );
    const builderSource = readSql(
      'supabase/functions/create-connect-payment/single-payment-builder.ts',
    );

    expect(indexSource).toContain("select('shipping_buffer_cents, insurance_rate')");
    expect(indexSource).toContain('calculateEstimatedSellerShippingDeductionCents');
    // Per-seller shipping deduction flows into allocation rows as shippingCents.
    expect(indexSource).toContain('shippingCents: group.shippingCents');
    // The compact allocation row the webhook reassembles keeps shippingCents.
    expect(builderSource).toContain('shippingCents: r.shippingCents');
    // Legacy moneyFlow-based single-seller metadata layout is gone.
    expect(indexSource).not.toContain('seller_shipping_deduction_cents');
    expect(indexSource).not.toContain('moneyFlow.shippingCents');
  });

  it('Connect PaymentIntent rejects quantity above one for single-product listings', () => {
    const source = readSql(
      'supabase/functions/create-connect-payment/index.ts',
    );

    expect(source).toContain(
      'quantity: z.number().int().min(1).max(1).default(1)',
    );
  });

  it('cron release only selects legacy shipments for wallet release', () => {
    const sql = readSql(
      'supabase/queries/triggers/shipments/fn_cron_release_shipment_funds.sql',
    );

    expect(sql).toContain('s.stripe_payment_intent_id IS NULL');
  });

  it('manual wallet release skips Connect shipments before wallet writes', () => {
    const sql = readSql(
      'supabase/queries/shipments/fn_release_shipment_funds.sql',
    );

    expect(sql).toContain('stripe_payment_intent_id IS NOT NULL');
    expect(sql.indexOf('stripe_payment_intent_id IS NOT NULL')).toBeLessThan(
      sql.indexOf('UPDATE public.wallets'),
    );
  });

  it('legacy shipment refund no-ops for Connect shipments before wallet writes', () => {
    const sql = readSql(
      'supabase/queries/shipments/fn_complete_shipment_refund.sql',
    );

    expect(sql).toContain('stripe_payment_intent_id IS NOT NULL');
    expect(sql.indexOf('stripe_payment_intent_id IS NOT NULL')).toBeLessThan(
      sql.indexOf('UPDATE public.wallets'),
    );
  });

  it('manual Connect payout release uses allocation net for SCT rows and keeps legacy shipping subtraction', () => {
    const sql = readSql(
      'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
    );

    expect(sql).toContain('o.stripe_transfer_group IS NOT NULL');
    expect(sql).toContain(
      'ROUND(COALESCE(SUM(oi.net_payout), 0) * 100)::INTEGER',
    );
    expect(sql).toContain(
      'ELSE ROUND(COALESCE(SUM(oi.net_payout), 0) * 100)::INTEGER - COALESCE(s.shipping_cost, 0)',
    );
    expect(sql).toContain('GREATEST(');
    expect(sql).toContain(
      's.shipping_cost IS NOT NULL AND s.shipping_cost > 0 AS has_shipping_cost_cents',
    );
    expect(sql).toContain(
      "WHEN NOT has_shipping_cost_cents THEN 'missing_shipping_cost'",
    );
  });

  it('manual Connect payout release repair preserves the 14-column admin view shape and appends settlement identifiers at the tail', () => {
    const sql = readSql(
      'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
    );
    const viewStart = sql.indexOf(
      'CREATE OR REPLACE VIEW public.admin_connect_payout_release_view',
    );
    const fromShipmentAmounts = sql.indexOf('FROM shipment_amounts;', viewStart);
    const outerSelectStart = sql.lastIndexOf('SELECT', fromShipmentAmounts);
    const outerColumns = sql.slice(
      outerSelectStart + 'SELECT'.length,
      fromShipmentAmounts,
    );

    const columnIndex = (column: string) => {
      const match = new RegExp(`\\b${column}\\b`).exec(outerColumns);
      return match ? match.index : -1;
    };

    const originalColumns = [
      'shipment_id',
      'seller_id',
      'seller_name',
      'order_id',
      'status',
      'completed_at',
      'stripe_payment_intent_id',
      'stripe_account_id',
      'stripe_onboarding_status',
      'release_amount_cents',
      'is_eligible',
      'ineligible_reason',
    ];

    let previousIndex = -1;
    for (const column of originalColumns) {
      const currentIndex = columnIndex(column);
      expect(currentIndex).toBeGreaterThan(-1);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }

    expect(columnIndex('transfer_group')).toBeGreaterThan(
      columnIndex('ineligible_reason'),
    );
    expect(columnIndex('stripe_transfer_id')).toBeGreaterThan(
      columnIndex('transfer_group'),
    );
    expect(columnIndex('transfer_group')).not.toBe(-1);
    expect(columnIndex('stripe_transfer_id')).not.toBe(-1);
    const outerSelectAliases = outerColumns
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const aliasMatch = /\bAS\s+([a-z_][a-z0-9_]*)$/i.exec(part);
        if (aliasMatch) {
          return aliasMatch[1];
        }

        return part;
      });

    expect(outerSelectAliases).toEqual([
      'shipment_id',
      'seller_id',
      'seller_name',
      'order_id',
      'status',
      'completed_at',
      'stripe_payment_intent_id',
      'stripe_account_id',
      'stripe_onboarding_status',
      'release_amount_cents',
      'is_eligible',
      'ineligible_reason',
      'transfer_group',
      'stripe_transfer_id',
    ]);
  });

  it('documents a rollback-first manual repair for verified no-payout stuck Connect runs', () => {
    const sql = readSql(
      'supabase/queries/payments/manual_repair_connect_payout_stuck_runs.sql',
    );

    expect(sql).toContain(
      'Do not mark a run failed until an operator confirms in Stripe that no payout',
    );
    expect(sql).toContain('CREATE TEMP TABLE verified_no_stripe_payout_run_ids');
    expect(sql).toContain('cpr.stripe_payout_id IS NULL');
    expect(sql).toContain(
      "cpr.status IN ('pending_reconciliation', 'reconciliation_needed')",
    );
    expect(sql).toContain(
      "crs.status IN ('pending_reconciliation', 'reconciliation_needed')",
    );
    expect(sql).toContain("status = 'failed'");
    expect(sql).toContain('ROLLBACK;');
    expect(sql).toContain('Replace ROLLBACK with COMMIT only after');
  });

  it('generate-shipping-label never overwrites the payout shipping_cost basis', () => {
    const source = readSql(
      'supabase/functions/generate-shipping-label/index.ts',
    );
    const shipmentUpdateStart = source.indexOf('const shipmentUpdate =');
    const shipmentUpdateEnd = source.indexOf('const { error: updateError }');
    const shipmentUpdate = source.slice(shipmentUpdateStart, shipmentUpdateEnd);

    expect(source).toContain('buildSanitizedEnviaResponseMetadata');
    expect(source).toContain('Extracted Envia label cost');
    expect(shipmentUpdate).not.toContain('shipping_cost');
  });
});
