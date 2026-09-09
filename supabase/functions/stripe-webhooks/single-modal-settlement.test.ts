import { describe, expect, it } from 'bun:test';

import {
	buildSinglePaymentIntentParams,
	deriveOrderGroupId,
	deriveShipmentId,
	SINGLE_MODAL_FLOW,
} from '../create-connect-payment/single-payment-builder.ts';
import { calculateCheckoutAllocation } from '../create-connect-payment/fee-calculator.ts';
import {
  buildSettlementOutcome,
  buildStripeFeeReconciliationPlan,
  classifySettlementFailure,
  parseSingleModalPayload,
  reassembleAllocationMetadata,
  resolvePaymentIntentSucceededAction,
} from './single-modal-settlement.ts';

/**
 * Strict TDD tests for the Phase 4 single-modal webhook settlement helpers.
 *
 * `stripe-webhooks/index.ts` is a Deno Edge Function (`serve()` from
 * `https://deno.land/std`, `https://esm.sh/...`) that `bun test` cannot run.
 * To honour Strict TDD the single-modal correctness is extracted as PURE,
 * side-effect-free helpers in `single-modal-settlement.ts`; `index.ts` only
 * wires Supabase RPC calls around them.
 *
 * Test layer: Unit (pure functions).
 * Spec acceptance criteria covered (single-modal-multiseller-checkout spec):
 *  - metadata reassembly from chunked Stripe PI metadata into a durable
 *    allocation (chunk_count, missing chunks, invalid JSON, productIds/
 *    shipmentId correlation).
 *  - webhook routing on `flow='single_modal_connect_checkout'` to order/
 *    shipment/order_item persistence, persisting stripe_charge_id +
 *    transfer_group.
 *  - on settlement failure: order stays in payment_processing, surfaced to
 *    admin recovery (retry-safe HTTP 200 return for the recovered path; 500
 *    for transport/precondition errors that left no order shell).
 *  - legacy `return_shipping`, per-seller Connect, and legacy `app_name`
 *    flows remain intact (routing precedence preserved by the pure router).
 *
 * The Stripe PaymentIntent metadata layout is produced by
 * `buildSinglePaymentIntentParams` (see single-payment-builder.ts):
 *   metadata = {
 *     app_name:'selene', flow:'single_modal_connect_checkout',
 *     transfer_group, order_id, order_group_id, buyer_id, address_id,
 *     total_sellers, buyer_total_cents, total_gross_cents,
 *     total_commission_cents, total_shipping_cents, total_seguro_cents,
 *     total_release_cents,
 *     allocation_chunk_count, allocation_json_0 .. allocation_json_N-1
 *   }
 * where joining `allocation_json_*` reproduces a compact JSON:
 *   { rows: [{ sellerId, shipmentId, productIds[], grossCents,
 *              commissionCents, shippingCents, seguroCents, netCents }] }
 */

const VALID_ORDER_ID = '11111111-2222-3333-4444-555555555555';
const VALID_BUYER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const VALID_ADDRESS_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const TRANSFER_GROUP = `selene_order_${VALID_ORDER_ID}`;

/** Build a compact allocation JSON blob identical to buildAllocationMetadata. */
function compactAllocationJson(
  rows: Array<{
    sellerId: string;
    shipmentId: string;
    productIds: string[];
    grossCents: number;
    commissionCents: number;
    shippingCents: number;
    seguroCents: number;
    netCents: number;
  }>,
): string {
  return JSON.stringify({ rows });
}

/** Chunk a string the same way chunkAllocationJson does (maxLen per chunk). */
function chunk(json: string, maxLen = 500): string[] {
  if (json.length === 0) return [''];
  const out: string[] = [];
  for (let i = 0; i < json.length; i += maxLen) out.push(json.slice(i, i + maxLen));
  return out;
}

/** Build a full single-modal PI metadata object from allocation rows. */
function buildFullMetadata(
  rows: Array<{
    sellerId: string;
    shipmentId: string;
    productIds: string[];
    grossCents: number;
    commissionCents: number;
    shippingCents: number;
    seguroCents: number;
    netCents: number;
  }>,
  overrides: Partial<Record<string, string>> = {},
): Record<string, string> {
  let buyerTotal = 0;
  let totalGross = 0;
  let totalCommission = 0;
  let totalShipping = 0;
  let totalSeguro = 0;
  let totalRelease = 0;
  for (const r of rows) {
    buyerTotal += r.grossCents + r.seguroCents;
    totalGross += r.grossCents;
    totalCommission += r.commissionCents;
    totalShipping += r.shippingCents;
    totalSeguro += r.seguroCents;
    totalRelease += r.netCents;
  }
  const chunks = chunk(compactAllocationJson(rows));
  const meta: Record<string, string> = {
    app_name: 'selene',
    flow: SINGLE_MODAL_FLOW,
    transfer_group: TRANSFER_GROUP,
    order_id: VALID_ORDER_ID,
    order_group_id: VALID_ORDER_ID,
    buyer_id: VALID_BUYER_ID,
    address_id: VALID_ADDRESS_ID,
    total_sellers: String(rows.length),
    buyer_total_cents: String(buyerTotal),
    total_gross_cents: String(totalGross),
    total_commission_cents: String(totalCommission),
    total_shipping_cents: String(totalShipping),
    total_seguro_cents: String(totalSeguro),
    total_release_cents: String(totalRelease),
    allocation_chunk_count: String(chunks.length),
  };
  chunks.forEach((c, i) => {
    meta[`allocation_json_${i}`] = c;
  });
  return { ...meta, ...overrides };
}

const sampleRows = () => [
  {
    sellerId: 'cccccccc-0000-0000-0000-000000000001',
    shipmentId: 'dddddddd-0000-0000-0000-000000000011',
    productIds: ['eeeeeeee-0000-0000-0000-000000000001'],
    grossCents: 100_000,
    commissionCents: 6_000,
    shippingCents: 20_000,
    seguroCents: 3_900,
    netCents: 74_000,
  },
  {
    sellerId: 'cccccccc-0000-0000-0000-000000000002',
    shipmentId: 'dddddddd-0000-0000-0000-000000000012',
    productIds: ['eeeeeeee-0000-0000-0000-000000000002'],
    grossCents: 80_000,
    commissionCents: 4_800,
    shippingCents: 15_000,
    seguroCents: 3_180,
    netCents: 60_200,
  },
];

describe('single-modal-settlement > reassembleAllocationMetadata', () => {
  it('reassembles one-product-per-shipment metadata produced by the checkout builder', () => {
    const idempotencyKey = 'settlement-reassembly-contract-key';
    const orderId = deriveOrderGroupId(idempotencyKey);
    const shipmentId = deriveShipmentId(idempotencyKey, 'product_gpu');
    const allocation = calculateCheckoutAllocation([
      {
        sellerId: 'cccccccc-0000-0000-0000-000000000001',
        shipmentId,
        subtotalCents: 100_000,
        shippingCents: 20_000,
      },
    ]);
    const params = buildSinglePaymentIntentParams({
      allocation,
      orderId,
      buyerId: VALID_BUYER_ID,
      customerId: 'cus_reassembly_contract',
      addressId: VALID_ADDRESS_ID,
      transferGroup: `selene_order_${orderId}`,
      shipmentProductIds: { [shipmentId]: ['product_gpu'] },
    });

    const reassembled = reassembleAllocationMetadata(params.metadata);

    expect(reassembled.rows).toEqual([
      expect.objectContaining({ shipmentId, productIds: ['product_gpu'] }),
    ]);
  });

  it('reassembles chunked allocation JSON into a typed allocation row set', () => {
    const rows = sampleRows();
    const meta = buildFullMetadata(rows);

    const reassembled = reassembleAllocationMetadata(meta);

    expect(reassembled.rows).toHaveLength(2);
    expect(reassembled.rows[0].shipmentId).toBe(rows[0].shipmentId);
    expect(reassembled.rows[0].productIds).toEqual(rows[0].productIds);
    expect(reassembled.rows[0].grossCents).toBe(100_000);
    expect(reassembled.rows[1].productIds).toEqual(rows[1].productIds);
    expect(reassembled.rows[1].netCents).toBe(60_200);
  });

  it('triangulates: reassembles a payload that spans MULTIPLE chunks', () => {
    // Force chunking by lowering the effective cap inside the stored metadata:
    // we craft metadata with a chunk_count of 3 and a joined blob that is the
    // concatenation of the three pieces.
    const rows = sampleRows();
    const full = compactAllocationJson(rows);
    // Slice into 3 uneven chunks and store them under allocation_json_0..2.
    const third = Math.ceil(full.length / 3);
    const c0 = full.slice(0, third);
    const c1 = full.slice(third, third * 2);
    const c2 = full.slice(third * 2);
    const meta = buildFullMetadata(rows, { allocation_chunk_count: '3' });
    meta.allocation_json_0 = c0;
    meta.allocation_json_1 = c1;
    meta.allocation_json_2 = c2;

    const reassembled = reassembleAllocationMetadata(meta);

    expect(reassembled.rows).toHaveLength(2);
    expect(reassembled.rows[1].shipmentId).toBe(rows[1].shipmentId);
  });

  it('throws missing_chunk_count when allocation_chunk_count is absent', () => {
    const meta = buildFullMetadata(sampleRows());
    delete meta.allocation_chunk_count;
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:missing_chunk_count',
    );
  });

  it('throws invalid_chunk_count when chunk_count is not a positive integer', () => {
    const meta = buildFullMetadata(sampleRows(), {
      allocation_chunk_count: '0',
    });
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:invalid_chunk_count',
    );
  });

  it('throws missing_chunk_N when a declared chunk key is absent', () => {
    const meta = buildFullMetadata(sampleRows(), {
      allocation_chunk_count: '2',
    });
    meta.allocation_json_0 = 'abc';
    // allocation_json_1 intentionally omitted
    delete meta.allocation_json_1;
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:missing_chunk_1',
    );
  });

  it('throws invalid_json when the joined chunks do not parse as JSON', () => {
    const meta = buildFullMetadata(sampleRows(), {
      allocation_chunk_count: '1',
    });
    meta.allocation_json_0 = 'not-json';
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:invalid_json',
    );
  });

  it('throws bad_shape when the parsed JSON is not the expected allocation envelope', () => {
    const meta = buildFullMetadata(sampleRows(), {
      allocation_chunk_count: '1',
    });
    meta.allocation_json_0 = JSON.stringify({ foo: [] });
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:bad_shape',
    );
  });

  it('throws bad_shape when rows is empty (no allocations)', () => {
    const meta = buildFullMetadata(sampleRows(), {
      allocation_chunk_count: '1',
    });
    meta.allocation_json_0 = JSON.stringify({ rows: [] });
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:bad_shape',
    );
  });

  it('throws missing_row_field when a row is missing the shipmentId correlation', () => {
    const rows = sampleRows();
    const broken = rows.map((r, i) =>
      i === 0 ? { ...r, shipmentId: '' as unknown as string } : r,
    );
    const meta = buildFullMetadata(rows, { allocation_chunk_count: '1' });
    meta.allocation_json_0 = compactAllocationJson(broken as never);
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:missing_row_field:shipmentId',
    );
  });

  it('throws missing_row_field when a row has no productIds (correlation lost)', () => {
    const rows = sampleRows();
    const broken = rows.map((r, i) =>
      i === 1 ? { ...r, productIds: [] } : r,
    );
    const meta = buildFullMetadata(rows, { allocation_chunk_count: '1' });
    meta.allocation_json_0 = compactAllocationJson(broken);
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:missing_row_field:productIds',
    );
  });

  it('throws duplicate_shipment_id when two rows share a shipmentId', () => {
    const rows = sampleRows();
    rows[1].shipmentId = rows[0].shipmentId;
    const meta = buildFullMetadata(rows, { allocation_chunk_count: '1' });
    meta.allocation_json_0 = compactAllocationJson(rows);
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:duplicate_shipment_id',
    );
  });

  it('throws row_breakdown when gross != commission + shipping + net for a row', () => {
    const rows = sampleRows();
    rows[0].netCents = 10_000; // breaks: commission(6k)+shipping(20k)+net(10k) != gross(100k)
    const meta = buildFullMetadata(rows, { allocation_chunk_count: '1' });
    meta.allocation_json_0 = compactAllocationJson(rows);
    expect(() => reassembleAllocationMetadata(meta)).toThrow(
      'INVALID_ALLOCATION_METADATA:row_breakdown',
    );
  });
});

describe('single-modal-settlement > parseSingleModalPayload', () => {
	it('accepts producer-built UUID v5 metadata and preserves it through recovery', () => {
		const idempotencyKey = 'settlement-contract-key';
		const orderId = deriveOrderGroupId(idempotencyKey);
		const shipmentId = deriveShipmentId(idempotencyKey, 'product_gpu');
		const allocation = calculateCheckoutAllocation([
			{
				sellerId: 'cccccccc-0000-0000-0000-000000000001',
				shipmentId,
				subtotalCents: 100_000,
				shippingCents: 20_000,
			},
		]);
		const params = buildSinglePaymentIntentParams({
			allocation,
			orderId,
			buyerId: VALID_BUYER_ID,
			customerId: 'cus_contract',
			addressId: VALID_ADDRESS_ID,
			transferGroup: `selene_order_${orderId}`,
			shipmentProductIds: { [shipmentId]: ['product_gpu'] },
		});
		const action = resolvePaymentIntentSucceededAction({
			metadata: params.metadata,
			amount: params.amount,
		});

		expect(orderId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(shipmentId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(action).toMatchObject({
			kind: 'single_modal',
			payload: { orderId, transferGroup: `selene_order_${orderId}` },
		});
		if (action.kind !== 'single_modal') return;
		expect(action.payload.rows).toEqual([
			expect.objectContaining({ shipmentId, productIds: ['product_gpu'] }),
		]);
		expect(
			buildSettlementOutcome({
				rpcResult: {
					success: false,
					order_id: orderId,
					error: 'ALLOCATION_WRITE_FAILED',
					status: 'payment_processing',
				},
				rpcError: null,
			}),
		).toMatchObject({ kind: 'recovered', reason: 'ALLOCATION_WRITE_FAILED' });
	});

	it('returns a structured settlement input with the full allocation and ids', () => {
    const rows = sampleRows();
    const meta = buildFullMetadata(rows);
    const intent = { metadata: meta, amount: 100_000 + 80_000 + 3_900 + 3_180 };

    const payload = parseSingleModalPayload(intent);

    expect(payload.stripePaymentIntentId).toBe(''); // router/test sets it later
    expect(payload.buyerId).toBe(VALID_BUYER_ID);
    expect(payload.addressId).toBe(VALID_ADDRESS_ID);
    expect(payload.orderId).toBe(VALID_ORDER_ID);
    expect(payload.transferGroup).toBe(TRANSFER_GROUP);
    expect(payload.amountCents).toBe(intent.amount);
    expect(payload.totalSellers).toBe(2);
    expect(payload.rows).toHaveLength(2);
    // Cross-checked top-level totals agree with the row sums.
    expect(payload.totalsCents.buyerTotal).toBe(187_080);
    expect(payload.totalsCents.gross).toBe(180_000);
    expect(payload.totalsCents.release).toBe(134_200);
  });

  it('throws missing_buyer_id when buyer_id metadata is absent', () => {
    const meta = buildFullMetadata(sampleRows());
    delete meta.buyer_id;
    const intent = { metadata: meta, amount: 187_080 };
    expect(() => parseSingleModalPayload(intent)).toThrow(
      'INVALID_SINGLE_MODAL_METADATA:missing_buyer_id',
    );
  });

  it('throws missing_address_id when address_id metadata is empty', () => {
    const meta = buildFullMetadata(sampleRows(), { address_id: '' });
    const intent = { metadata: meta, amount: 187_080 };
    expect(() => parseSingleModalPayload(intent)).toThrow(
      'INVALID_SINGLE_MODAL_METADATA:missing_address_id',
    );
  });

  it('throws missing_transfer_group when transfer_group metadata is absent', () => {
    const meta = buildFullMetadata(sampleRows());
    delete meta.transfer_group;
    const intent = { metadata: meta, amount: 187_080 };
    expect(() => parseSingleModalPayload(intent)).toThrow(
      'INVALID_SINGLE_MODAL_METADATA:missing_transfer_group',
    );
  });

  it('throws buyer_total_mismatch when buyer_total_cents does not reconcile with rows', () => {
    const rows = sampleRows();
    const meta = buildFullMetadata(rows, { buyer_total_cents: '999' });
    const intent = { metadata: meta, amount: 187_080 };
    expect(() => parseSingleModalPayload(intent)).toThrow(
      'INVALID_SINGLE_MODAL_METADATA:buyer_total_mismatch',
    );
  });

  it('throws amount_mismatch when the platform intent amount differs from the allocation total', () => {
    const meta = buildFullMetadata(sampleRows());
    const intent = { metadata: meta, amount: 187_081 };
    expect(() => parseSingleModalPayload(intent)).toThrow(
      'INVALID_SINGLE_MODAL_METADATA:amount_mismatch',
    );
  });

  it('throws total_gross_mismatch when a declared top-level total diverges from the row sums', () => {
    const meta = buildFullMetadata(sampleRows(), { total_gross_cents: '123' });
    const intent = { metadata: meta, amount: 187_080 };
    expect(() => parseSingleModalPayload(intent)).toThrow(
      'INVALID_SINGLE_MODAL_METADATA:total_gross_mismatch',
    );
  });

  it('throws total_release_mismatch when a declared release total diverges from the row sums', () => {
    const meta = buildFullMetadata(sampleRows(), { total_release_cents: '1' });
    const intent = { metadata: meta, amount: 187_080 };
    expect(() => parseSingleModalPayload(intent)).toThrow(
      'INVALID_SINGLE_MODAL_METADATA:total_release_mismatch',
    );
  });

  it('throws empty allocation metadata before any top-level validation', () => {
    const intent = {
      metadata: {
        flow: SINGLE_MODAL_FLOW,
        buyer_id: VALID_BUYER_ID,
        address_id: VALID_ADDRESS_ID,
        order_id: VALID_ORDER_ID,
        transfer_group: TRANSFER_GROUP,
        total_sellers: '1',
      },
      amount: 0,
    };
    expect(() => parseSingleModalPayload(intent)).toThrow(
      'INVALID_ALLOCATION_METADATA:missing_chunk_count',
    );
  });
});

describe('single-modal-settlement > buildStripeFeeReconciliationPlan', () => {
  it('returns missing when the expanded balance transaction is unavailable', () => {
    expect(
      buildStripeFeeReconciliationPlan({
        existingActualStripeFeeCents: null,
        charge: { id: 'ch_1', balance_transaction: null },
        reconciledAt: '2026-07-10T00:00:00.000Z',
      }),
    ).toEqual({ kind: 'missing_balance_transaction' });
  });

  it('returns already_reconciled when the order already has an actual fee', () => {
    expect(
      buildStripeFeeReconciliationPlan({
        existingActualStripeFeeCents: 21_992,
        charge: {
          id: 'ch_1',
          balance_transaction: { fee: 21_992 },
        },
        reconciledAt: '2026-07-10T00:00:00.000Z',
      }),
    ).toEqual({ kind: 'already_reconciled' });
  });

  it('returns the authoritative BalanceTransaction fee when reconciliation is needed', () => {
    expect(
      buildStripeFeeReconciliationPlan({
        existingActualStripeFeeCents: null,
        charge: {
          id: 'ch_1',
          balance_transaction: { fee: 21_992 },
        },
        reconciledAt: '2026-07-10T00:00:00.000Z',
      }),
    ).toEqual({
      kind: 'ready',
      actualStripeFeeCents: 21_992,
      stripeFeeReconciledAt: '2026-07-10T00:00:00.000Z',
    });
  });
});

describe('single-modal-settlement > resolvePaymentIntentSucceededAction', () => {
  it('routes to single_modal when flow metadata marker is present and payload is valid', () => {
    const meta = buildFullMetadata(sampleRows());
    const action = resolvePaymentIntentSucceededAction({
      metadata: meta,
      amount: 187_080,
    });
    expect(action.kind).toBe('single_modal');
    if (action.kind !== 'single_modal') return;
    expect(action.payload.orderId).toBe(VALID_ORDER_ID);
  });

  it('routes to return_shipping when metadata.type=return_shipping (precedence over flow)', () => {
    const meta = buildFullMetadata(sampleRows(), { type: 'return_shipping' });
    const action = resolvePaymentIntentSucceededAction({ metadata: meta });
    expect(action.kind).toBe('return_shipping');
  });

  it('retires seller-grouped settlement when seller_id metadata is present and flow is not single-modal', () => {
    const meta = buildFullMetadata(sampleRows(), {
      flow: 'per_seller',
      seller_id: 'cccccccc-0000-0000-0000-000000000099',
    });
    delete meta.allocation_chunk_count;
    delete meta.allocation_json_0;
    const action = resolvePaymentIntentSucceededAction({ metadata: meta });
    expect(action.kind).toBe('retired_grouped_settlement');
    if (action.kind === 'retired_grouped_settlement') {
      expect(action.reason).toBe('LEGACY_GROUPED_SETTLEMENT_METADATA');
    }
  });

  it('retires the legacy app settlement when no single-modal flow marker is present', () => {
    const meta: Record<string, string> = {
      app_name: 'selene',
      buyer_id: VALID_BUYER_ID,
      product_ids: '[]',
      address_id: VALID_ADDRESS_ID,
    };
    const action = resolvePaymentIntentSucceededAction({ metadata: meta });
    expect(action.kind).toBe('retired_grouped_settlement');
  });

  it('routes to ignore when no known metadata marker is present', () => {
    const action = resolvePaymentIntentSucceededAction({ metadata: {} });
    expect(action.kind).toBe('ignore');
  });

  it('preserves the charged metadata and amount for a malformed single-modal recovery shell', () => {
    const meta = buildFullMetadata(sampleRows());
    delete meta.allocation_chunk_count;
    expect(resolvePaymentIntentSucceededAction({ metadata: meta, amount: 187_080 })).toEqual({
      kind: 'invalid_single_modal_metadata',
      reason: 'INVALID_ALLOCATION_METADATA:missing_chunk_count',
      recoveryShell: {
        sourceMetadata: meta,
        chargedAmountCents: 187_080,
      },
    });
  });

  it('preserves legacy grouped metadata for durable refund compensation', () => {
    const meta: Record<string, string> = {
      seller_id: 'cccccccc-0000-0000-0000-000000000099',
      buyer_id: VALID_BUYER_ID,
      product_ids: '[]',
    };

    expect(resolvePaymentIntentSucceededAction({ metadata: meta, amount: 12_345 })).toEqual({
      kind: 'retired_grouped_settlement',
      reason: 'LEGACY_GROUPED_SETTLEMENT_METADATA',
      recoveryShell: {
        sourceMetadata: meta,
        chargedAmountCents: 12_345,
      },
    });
  });
});

describe('single-modal-settlement > buildSettlementOutcome', () => {
  it('returns ok when the RPC reports success', () => {
    const outcome = buildSettlementOutcome({
      rpcResult: { success: true, order_id: VALID_ORDER_ID, status: 'created' },
      rpcError: null,
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.body).toEqual({ received: true });
    }
  });

  it('returns recovered when the RPC reports an allocation-write failure (retry-safe 200)', () => {
    const outcome = buildSettlementOutcome({
      rpcResult: {
        success: false,
        order_id: VALID_ORDER_ID,
        error: 'ALLOCATION_WRITE_FAILED',
        status: 'payment_processing',
      },
      rpcError: null,
    });
    expect(outcome.kind).toBe('recovered');
    if (outcome.kind === 'recovered') {
      expect(outcome.reason).toBe('ALLOCATION_WRITE_FAILED');
    }
  });

  it('preserves the settlement runtime version returned by the executed RPC for recovery diagnostics', () => {
    const outcome = buildSettlementOutcome({
      rpcResult: {
        success: false,
        error: 'ALLOCATION_WRITE_FAILED',
        runtime_version: 'single_modal_settlement_v2',
      },
      rpcError: null,
    });

    expect(outcome).toEqual({
      kind: 'recovered',
      reason: 'ALLOCATION_WRITE_FAILED',
      classification: { kind: 'transient', refundRequired: false },
      runtimeVersion: 'single_modal_settlement_v2',
    });
  });

  it('reports no runtime version when the RPC response does not observe one', () => {
    const outcome = buildSettlementOutcome({
      rpcResult: { success: true },
      rpcError: null,
    });

    expect(outcome).toEqual({
      kind: 'ok',
      body: { received: true },
      runtimeVersion: null,
    });
  });

  it('triangulates: recovered path also surfaces duplicate-PI idempotent success reason', () => {
    const outcome = buildSettlementOutcome({
      rpcResult: { success: false, error: 'ALREADY_PROCESSED' },
      rpcError: null,
    });
    expect(outcome.kind).toBe('recovered');
    if (outcome.kind === 'recovered') {
      expect(outcome.reason).toBe('ALREADY_PROCESSED');
    }
  });

  it('returns fatal_error when the RPC transport threw (no shell persisted -> retry)', () => {
    const outcome = buildSettlementOutcome({
      rpcResult: null,
      rpcError: { message: 'network down' },
    });
    expect(outcome.kind).toBe('fatal_error');
    if (outcome.kind === 'fatal_error') {
      expect(outcome.message).toContain('network down');
    }
  });

  it('returns fatal_error when the RPC returned an unexpected payload shape', () => {
    const outcome = buildSettlementOutcome({
      rpcResult: { weird: true },
      rpcError: null,
    });
    expect(outcome.kind).toBe('fatal_error');
    if (outcome.kind === 'fatal_error') {
      expect(outcome.message).toBe('UNEXPECTED_RPC_RESPONSE');
    }
  });

  it('treats a duplicate idempotent success (status=duplicate) as ok (not recovered)', () => {
    const outcome = buildSettlementOutcome({
      rpcResult: { success: true, order_id: VALID_ORDER_ID, status: 'duplicate' },
      rpcError: null,
    });
    expect(outcome.kind).toBe('ok');
  });

  it('marks specified allocation failures as semantic and refund-required', () => {
    expect(classifySettlementFailure('ONE_PRODUCT_PER_SHIPMENT_REQUIRED')).toEqual({
      kind: 'semantic',
      refundRequired: true,
    });

    const outcome = buildSettlementOutcome({
      rpcResult: {
        success: false,
        error: 'shipment allocation rejected',
        failure_code: 'PRODUCT_NOT_RESERVED',
      },
      rpcError: null,
    });
    expect(outcome).toEqual({
      kind: 'recovered',
      reason: 'shipment allocation rejected',
      classification: { kind: 'semantic', refundRequired: true },
      runtimeVersion: null,
    });
  });

  it('treats unknown and malformed metadata failures as transient or semantic respectively', () => {
    expect(classifySettlementFailure('ETIMEDOUT')).toEqual({
      kind: 'transient',
      refundRequired: false,
    });
    expect(classifySettlementFailure('INVALID_ALLOCATION_METADATA:missing_chunk_0')).toEqual({
      kind: 'semantic',
      refundRequired: true,
    });
  });
});
