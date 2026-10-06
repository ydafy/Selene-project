import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const readSql = (relativePath: string) =>
  readFileSync(join(root, relativePath), 'utf8').replace(/\s+/g, ' ');

/**
 * Split a SELECT projection into its top-level comma-separated column
 * expressions. Parenthesis- and string-aware: commas nested inside function
 * calls (e.g. `COALESCE(x, FALSE)`) or SQL string literals do not split
 * columns; only depth-0 commas outside literals do.
 */
const splitTopLevelProjectionColumns = (projection: string): string[] => {
  const columns: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < projection.length; i++) {
    const char = projection[i];
    if (char === "'") {
      // SQL escapes a literal quote by doubling it ('').
      if (inString && projection[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
    } else if (!inString) {
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
      } else if (char === ',' && depth === 0) {
        columns.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }
  const lastColumn = current.trim();
  if (lastColumn.length > 0) {
    columns.push(lastColumn);
  }
  return columns;
};

/**
 * Isolate the outer projection of the admin payout release view: the
 * top-level `SELECT` immediately preceding the outer `FROM shipment_amounts`
 * (the operational copy aliases the CTE as `sa`, so no trailing semicolon is
 * required). Returns the top-level column expressions in source order.
 */
const getOuterViewProjectionColumns = (sql: string): string[] => {
  const viewStart = sql.indexOf(
    'CREATE OR REPLACE VIEW public.admin_connect_payout_release_view',
  );
  expect(viewStart).toBeGreaterThan(-1);
  const fromShipmentAmounts = sql.indexOf('FROM shipment_amounts', viewStart);
  expect(fromShipmentAmounts).toBeGreaterThan(-1);
  // The nearest SELECT before the outer FROM is the outer projection's
  // SELECT; inner CTE/subquery SELECTs all sit further back.
  const outerSelectStart = sql.lastIndexOf('SELECT', fromShipmentAmounts);
  expect(outerSelectStart).toBeGreaterThan(-1);
  const projection = sql.slice(
    outerSelectStart + 'SELECT'.length,
    fromShipmentAmounts,
  );
  return splitTopLevelProjectionColumns(projection);
};

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

    expect(indexSource).toContain(
      "select('shipping_buffer_cents, insurance_rate, service_fee_pct')",
    );
    expect(indexSource).toContain('calculateEstimatedSellerShippingDeductionCents');
    // Each product allocation carries its own shipping deduction.
    expect(indexSource).toContain('shippingCents: product.shippingCents');
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

  it('manual Connect payout release deducts the legacy shipping cost and gates eligibility on it', () => {
    // Canonical contract (approved specs + migration 20260915): single-modal
    // rows release the checkout-fixed ROUND(SUM(order_items.net_payout) * 100)
    // only; legacy rows deduct COALESCE(s.shipping_cost, 0) and require a
    // valid shipping cost. label_provider_cost_cents is evidence-only and
    // must never appear in the operational payout expectation.
    const sql = readSql(
      'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
    );

    expect(sql).toContain(
      'ROUND(COALESCE(SUM(oi.net_payout), 0) * 100)::INTEGER',
    );
    expect(sql).toContain('- COALESCE(s.shipping_cost, 0)');
    expect(sql).toContain('GREATEST(');
    expect(sql).toContain(
      's.shipping_cost IS NOT NULL AND s.shipping_cost > 0 AS has_shipping_cost_cents',
    );
    expect(sql).toContain(
      '(sa.transfer_group IS NOT NULL OR sa.has_shipping_cost_cents)',
    );
    expect(sql).toContain(
      "WHEN sa.transfer_group IS NULL AND NOT sa.has_shipping_cost_cents THEN 'missing_shipping_cost'",
    );
    expect(sql).not.toContain('label_provider_cost_cents');
  });

  it('manual Connect payout release repair preserves the 22-column admin view shape and appends settlement/retry columns at the tail', () => {
    const sql = readSql(
      'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
    );
    const viewStart = sql.indexOf(
      'CREATE OR REPLACE VIEW public.admin_connect_payout_release_view',
    );
    // The operational copy aliases the CTE reference
    // (`FROM shipment_amounts sa`), so locate the outer FROM without
    // requiring a trailing semicolon right after the CTE name.
    const fromShipmentAmounts = sql.indexOf('FROM shipment_amounts', viewStart);
    expect(fromShipmentAmounts).toBeGreaterThan(-1);
    const outerSelectStart = sql.lastIndexOf('SELECT', fromShipmentAmounts);
    expect(outerSelectStart).toBeGreaterThan(-1);
    const outerColumns = sql.slice(outerSelectStart, fromShipmentAmounts);

    // The 12 original columns keep their relative order; `transfer_group` and
    // `stripe_transfer_id` follow as the first-phase append; the 8 retry-era
    // columns are appended at the tail. Expression columns are anchored by
    // their trailing `AS` alias (expressions contain internal commas, e.g.
    // COALESCE in `is_retryable`), and CTE-passthrough columns by their
    // `sa.`-qualified reference. This preserves the append-at-tail regression
    // guard while validating the current 22-column retry-era shape.
    const orderedColumns = [
      'sa.shipment_id',
      'sa.seller_id',
      'sa.seller_name',
      'sa.order_id',
      'sa.status,',
      'sa.completed_at',
      'sa.stripe_payment_intent_id',
      'sa.stripe_account_id',
      'sa.stripe_onboarding_status',
      'sa.release_amount_cents',
      'AS is_eligible',
      'AS ineligible_reason',
      'sa.transfer_group,',
      'sa.stripe_transfer_id,',
      'AS payout_run_id',
      'AS payout_run_status',
      'AS payout_run_amount_cents',
      'AS payout_run_failure_reason',
      'AS payout_run_failed_at',
      'payout_run.retry_of_run_id,',
      'AS is_retryable',
      'AS requires_manual_review',
    ];
    expect(orderedColumns).toHaveLength(22);

    let previousIndex = -1;
    for (const column of orderedColumns) {
      const currentIndex = outerColumns.indexOf(column);
      expect(currentIndex).toBeGreaterThan(-1);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });

  it('admin payout release view outer SELECT projects exactly 22 top-level columns', () => {
    // The token-order check above only proves expected tokens appear in
    // order; it silently accepts EXTRA outer columns. This guard proves the
    // actual projection cardinality by isolating the outer
    // `SELECT ... FROM shipment_amounts` span and counting top-level
    // comma-separated column expressions (parenthesis- and string-aware, so
    // commas inside COALESCE/CASE do not split columns).
    const sql = readSql(
      'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
    );

    const columns = getOuterViewProjectionColumns(sql);
    expect(columns).toHaveLength(22);

    // Ordered original/tail aliases: each top-level column must match its
    // expected signature at its exact position (whitespace-normalized).
    const signatures = columns.map((column) => column.replace(/\s+/g, ' '));
    const expectedSignatures = [
      'sa.shipment_id',
      'sa.seller_id',
      'sa.seller_name',
      'sa.order_id',
      'sa.status',
      'sa.completed_at',
      'sa.stripe_payment_intent_id',
      'sa.stripe_account_id',
      'sa.stripe_onboarding_status',
      'sa.release_amount_cents',
      ') AS is_eligible',
      'END AS ineligible_reason',
      'sa.transfer_group',
      'sa.stripe_transfer_id',
      'payout_run.id AS payout_run_id',
      'payout_run.status AS payout_run_status',
      'payout_run.amount AS payout_run_amount_cents',
      'payout_run.failure_reason AS payout_run_failure_reason',
      'payout_run.failed_at AS payout_run_failed_at',
      'payout_run.retry_of_run_id',
      ') AS is_retryable',
      ') AS requires_manual_review',
    ];
    expect(signatures).toHaveLength(expectedSignatures.length);
    signatures.forEach((signature, index) => {
      // Simple passthrough columns match exactly; expression columns are
      // anchored by their trailing `AS` alias / qualified ref tail.
      expect(signature.endsWith(expectedSignatures[index])).toBe(true);
    });
  });

  it('admin payout release view guard rejects an extra appended outer column', () => {
    // Regression for the guard weakness: the previous ordered-token check
    // accepted a mutated projection with an extra appended column because it
    // only verified expected tokens appear in order. The cardinality guard
    // must reject it.
    const sql = readSql(
      'supabase/queries/payments/admin_connect_payout_release_view_shipping_cost_fix.sql',
    );
    const viewStart = sql.indexOf(
      'CREATE OR REPLACE VIEW public.admin_connect_payout_release_view',
    );
    const fromShipmentAmounts = sql.indexOf('FROM shipment_amounts', viewStart);
    const mutatedSql =
      sql.slice(0, fromShipmentAmounts) +
      ', sa.extra_unauthorized_column ' +
      sql.slice(fromShipmentAmounts);

    expect(() => {
      expect(getOuterViewProjectionColumns(mutatedSql)).toHaveLength(22);
    }).toThrow();
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
