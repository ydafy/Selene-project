import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const readSql = (relativePath: string) =>
  readFileSync(join(root, relativePath), 'utf8').replace(/\s+/g, ' ');

/**
 * Strict TDD static-invariant guards for the Phase 4 single-modal settlement
 * RPC. There is no live Postgres under `bun test`, so these guards assert the
 * SQL text itself encodes the spec's structural + recovery invariants — the
 * same pattern used by the existing `connectMoneyFlowGuards.test.ts` for the
 * legacy connect `fn_create_shipment_from_payment`.
 *
 * Spec acceptance criteria enforced here (single-modal-multiseller-checkout +
 * shipments specs):
 *  - Function signature accepts platform PI id, charge id, amount, transfer
 *    group, and a structured allocation JSON payload.
 *  - Idempotent on `stripe_payment_intent_id` (returns existing order without
 *    re-doing allocation when already settled).
 *  - Persists `orders.stripe_payment_intent_id`, `orders.stripe_charge_id`,
 *    `orders.stripe_transfer_group`, `orders.payment_processing=false`
 *    on the order shell, BEFORE the allocation write attempt.
 *  - Persists `shipments.id` from the allocation `shipmentId` and leaves
 *    `shipments.stripe_transfer_id` NULL until the Phase 5 admin release.
 *  - Order starts as `status='pending'` and only advances after the durable
 *    allocation writes; on allocation-write failure the shell stays `pending`
 *    with `payment_processing=true` + `payment_processing_reason`.
 *  - Marks the previously-RESERVED products SOLD only after allocation writes.
 *  - SECURITY DEFINER + revoke from PUBLIC/anon/authenticated, grant to
 *    service_role ONLY (admin settlement runs server-side via the webhook).
 *  - Legacy `fn_create_shipment_from_payment` is retired so it cannot create
 *    seller-grouped shipments.
 */

const RPC_PATH = 'supabase/queries/orders/fn_create_shipments_from_single_payment.sql';

describe('single-modal shipment RPC SQL guards', () => {
  const sql = readSql(RPC_PATH);

  it('declares fn_create_shipments_from_single_payment with the platform-pi signature', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_create_shipments_from_single_payment(',
    );
    expect(sql).toContain('p_stripe_payment_intent_id TEXT');
    expect(sql).toContain('p_stripe_charge_id TEXT');
    expect(sql).toContain('p_amount_received BIGINT');
    expect(sql).toContain('p_transfer_group TEXT');
    expect(sql).toContain('p_allocation JSONB');
    expect(sql).toContain('RETURNS JSONB');
    expect(sql).toContain('LANGUAGE plpgsql');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
  });

  it('is idempotent on stripe_payment_intent_id (looks up an existing order first)', () => {
    expect(sql).toContain(
      "WHERE stripe_payment_intent_id = p_stripe_payment_intent_id",
    );
    expect(sql).toContain('FOR UPDATE');
  });

  it('persists the platform charge id and transfer_group on the order row', () => {
    expect(sql).toContain('stripe_charge_id');
    expect(sql).toContain('stripe_transfer_group');
    // The order shell insert must weave in p_stripe_charge_id /
    // p_transfer_group (metadata-driven), not derive them from elsewhere.
    expect(sql).toContain('p_stripe_charge_id');
    expect(sql).toContain('p_transfer_group');
  });

  it('creates the order shell with status=pending and payment_processing=false BEFORE the allocation attempt', () => {
    // The order shell INSERT VALUES comes BEFORE the allocation block's
    // EXCEPTION WHEN OTHERS THEN handler, so a failed allocation leaves the
    // shell recoverable for admin ops. (We match the handler start, not bare
    // "EXCEPTION", which would falsely match RAISE EXCEPTION lines.)
    const insertOrderIdx = sql.indexOf("VALUES (");
    const allocateIdx = sql.indexOf('EXCEPTION WHEN OTHERS THEN');
    expect(insertOrderIdx).toBeGreaterThan(-1);
    expect(allocateIdx).toBeGreaterThan(insertOrderIdx);
    expect(sql).toContain("'pending'");
    expect(sql).toContain('payment_processing');
  });

  it('persists each shipment with the deterministic shipmentId from the allocation row', () => {
    // The shipment insert sets shipments.id from the per-row allocation id.
    expect(sql).toContain('INSERT INTO public.shipments');
    expect(sql).toContain('(p_allocation ->> ');
    // Shipments are seeded as a sub-pending status while the allocation write
    // is still in progress (only advanced to 'paid' after item writes succeed).
    expect(sql).toContain("'preparing'");
  });

  it('leaves stripe_transfer_id NULL on shipments at payment success (Phase 5 fills it)', () => {
    // The shipment INSERT statement (up to its ON CONFLICT clause) must NOT
    // reference stripe_transfer_id — it is written only by the Phase 5 admin
    // release Transfer step. We slice to ON CONFLICT (the shipment insert
    // terminator in this implementation) rather than a RETURNING id INTO that
    // here belongs to the ORDER insert.
    const shipmentInsertStart = sql.indexOf('INSERT INTO public.shipments');
    const shipmentInsertEnd = sql.indexOf('ON CONFLICT (id) DO NOTHING');
    expect(shipmentInsertStart).toBeGreaterThan(-1);
    expect(shipmentInsertEnd).toBeGreaterThan(shipmentInsertStart);
    const shipmentInsert = sql.slice(shipmentInsertStart, shipmentInsertEnd);
    expect(shipmentInsert).not.toContain('stripe_transfer_id');
  });

  it('persists order_items commission_amount, shipping_amount, shipping_payer=seller, net_payout from the allocation row', () => {
    expect(sql).toContain('INSERT INTO public.order_items');
    expect(sql).toContain('commission_amount');
    expect(sql).toContain('shipping_amount');
    expect(sql).toContain('shipping_payer');
    expect(sql).toContain("'seller'");
    expect(sql).toContain('net_payout');
    // shipping_payer is inserted as the 'seller' literal under the shipping_payer
    // column of the order_items INSERT (VALUES block), NOT a free-floating
    // 'seller' string: assert the column name and literal both live inside the
    // order_items INSERT region.
    const oiStart = sql.indexOf('INSERT INTO public.order_items');
    const oiEnd = sql.indexOf('ON CONFLICT DO NOTHING', oiStart);
    expect(oiStart).toBeGreaterThan(-1);
    const orderItemsInsert = sql.slice(oiStart, oiEnd);
    expect(orderItemsInsert).toContain('shipping_payer');
    expect(orderItemsInsert).toContain("'seller'");
  });

  it('marks RESERVED products SOLD only after allocation writes', () => {
    const orderItemInsertIdx = sql.indexOf('INSERT INTO public.order_items');
    const markSoldIdx = sql.indexOf("status = 'SOLD'");
    expect(orderItemInsertIdx).toBeGreaterThan(-1);
    expect(markSoldIdx).toBeGreaterThan(orderItemInsertIdx);
    // The product SOLD guard keys on status='RESERVED' (this implementation
    // does not alias the products table as `p`; the spec invariant is the
    // RESERVED->SOLD transition while still owned by the seller).
    expect(sql).toContain("status = 'RESERVED'");
    expect(sql).toContain("status = 'SOLD'");
  });

  it('rejects settlement unless every product_id is found, seller-owned, and RESERVED before paid settlement', () => {
    expect(sql).toContain('v_found_product_count');
    expect(sql).toContain('v_reserved_product_count');
    expect(sql).toContain('PRODUCT_ID_NOT_FOUND_OR_NOT_OWNED');
    expect(sql).toContain('PRODUCT_NOT_RESERVED');
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain("AND status = 'RESERVED'");
    expect(sql).toContain('array_length(v_product_ids, 1)');
  });

  it('rejects allocation rows containing more than one product before creating a shipment', () => {
    expect(sql).toContain('ONE_PRODUCT_PER_SHIPMENT_REQUIRED');
    expect(sql).toContain('array_length(v_product_ids, 1) <> 1');
  });

  it('advances shipment status and derives the order status only on success', () => {
    expect(sql).toContain("'paid'");
    expect(sql).toContain('fn_derive_order_status');
  });

  it('on allocation-write failure marks the shell payment_processing=true + reason and returns a recovery payload (NOT a raise)', () => {
    expect(sql).toContain('EXCEPTION WHEN OTHERS THEN');
    expect(sql).toContain('payment_processing = true');
    expect(sql).toContain('payment_processing_reason');
    expect(sql).toContain("'status', 'payment_processing'");
    expect(sql).toContain("'success', false");
  });

  it('returns a typed failure code and settlement version for recovery classification', () => {
    expect(sql).toContain('v_failure_code');
    expect(sql).toContain("'failure_code', v_failure_code");
    expect(sql).toContain("'runtime_version', 'single_modal_settlement_v2'");
  });

  it('returns a typed JSONB result on both created and duplicate outcomes', () => {
    expect(sql).toContain("'success', true");
    expect(sql).toContain("'status', 'created'");
    expect(sql).toContain("'status', 'duplicate'");
  });

  it('grants EXECUTE to service_role ONLY (revoked from PUBLIC/anon/authenticated)', () => {
    const revokeIdx = sql.indexOf('REVOKE EXECUTE');
    expect(revokeIdx).toBeGreaterThan(-1);
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('GRANT EXECUTE');
    expect(sql).toContain('TO service_role');
  });
});

describe('single-modal settlement retires the legacy seller-grouped RPC', () => {
  it('legacy fn_create_shipment_from_payment rejects before reaching grouped writes', () => {
    const legacy = readSql(
      'supabase/queries/orders/fn_create_shipment_from_payment.sql',
    );
    expect(legacy).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_create_shipment_from_payment(',
    );
    expect(legacy).toMatch(
      /BEGIN\s+RAISE EXCEPTION 'LEGACY_GROUPED_SHIPMENT_SETTLEMENT_RETIRED'/,
    );
  });
});
