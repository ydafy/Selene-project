import { describe, expect, it } from 'bun:test';

import {
  STRIPE_ALLOCATION_VALUE_MAX_LEN,
  SINGLE_MODAL_FLOW,
  assertReservationSucceeded,
  buildAllocationMetadata,
  buildCheckoutIdentifiers,
  buildCreateConnectPaymentResponse,
  buildSinglePaymentIntentParams,
  buildTransferGroup,
  chunkAllocationJson,
  normalizeCreateConnectPaymentRequest,
  type ReservationResult,
} from './single-payment-builder.ts';
import {
  assertValidCheckoutAllocation,
  calculateCheckoutAllocation,
  type CheckoutAllocation,
} from './fee-calculator.ts';
import { calculateOrderCalculations } from '../../../apps/frontend/core/hooks/useOrderCalculations.ts';

/**
 * Strict TDD tests for the Phase 3 single-modal multi-seller checkout
 * create-connect-payment runtime. `index.ts` is a Deno/Supabase Edge Function
 * whose `serve()` handler cannot run under `bun test` (it imports
 * `https://deno.land/std` and `https://esm.sh/...`). To honour Strict TDD the
 * single-PI concerns are extracted as PURE, side-effect-free builder functions
 * in `single-payment-builder.ts`; `index.ts` only wires Stripe/Supabase calls
 * around them.
 *
 * Test layer: Unit (pure functions).
 * Spec acceptance criteria covered:
 *  - Single Platform PaymentIntent: one amount, no transfer_data.destination,
 *    no application_fee_amount, automatic payment methods only.
 *  - Settlement identifiers: transfer_group present in both PI metadata and
 *    the response.
 *  - Durable per-shipment allocation: allocation JSON embedded in PI metadata
 *    chunked to fit Stripe's 500-char metadata value limit.
 *  - Single-secret response: exactly one clientSecret, transferGroup, amount
 *    — never a per-seller paymentIntents[] array.
 */

const buildAllocation = (
  rows: Array<{ shipmentId: string; subtotalCents: number; shippingCents: number }>,
): CheckoutAllocation => {
  const allocation = calculateCheckoutAllocation(
    rows.map((r, i) => ({
      sellerId: `seller_${i}`,
      shipmentId: r.shipmentId,
      subtotalCents: r.subtotalCents,
      shippingCents: r.shippingCents,
    })),
  );
  assertValidCheckoutAllocation(allocation);
  return allocation;
};

describe('single-payment-builder > buildTransferGroup', () => {
  it('produces a stable, Stripe-safe transfer_group from the order id', () => {
    const orderId = '11111111-2222-3333-4444-555555555555';
    const group = buildTransferGroup(orderId);
    expect(group).toBe('selene_order_11111111-2222-3333-4444-555555555555');
    expect(group.length).toBeLessThanOrEqual(100);
  });

  it('triangulates: different order ids yield different, non-colliding groups', () => {
    const a = buildTransferGroup('aaaaaaaa-0000-0000-0000-000000000000');
    const b = buildTransferGroup('bbbbbbbb-0000-0000-0000-000000000000');
    expect(a).not.toBe(b);
    expect(a.endsWith('aaaaaaaa-0000-0000-0000-000000000000')).toBe(true);
  });
});

describe('single-payment-builder > chunkAllocationJson', () => {
  it('returns a single chunk when the JSON fits the metadata value limit', () => {
    const json = JSON.stringify({ a: 'short' });
    const chunks = chunkAllocationJson(json);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(json);
    expect(chunks[0].length).toBeLessThanOrEqual(STRIPE_ALLOCATION_VALUE_MAX_LEN);
  });

  it('splits a long JSON string into chunks that never exceed the value limit', () => {
    const big = 'x'.repeat(STRIPE_ALLOCATION_VALUE_MAX_LEN * 2 + 37);
    const chunks = chunkAllocationJson(big);
    expect(chunks.length).toBe(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(STRIPE_ALLOCATION_VALUE_MAX_LEN);
    }
  });

  it('reassembles by plain concatenation back into the original JSON', () => {
    const payload = JSON.stringify({
      rows: Array.from({ length: 9 }, (_, i) => ({
        sellerId: `seller_${i}`,
        shipmentId: `ship_${i}`,
        grossCents: 100_000 + i * 137,
        commissionCents: 6_000,
        shippingCents: 20_000,
        seguroCents: 3_900,
        netCents: 74_000,
      })),
    });
    const chunks = chunkAllocationJson(payload);
    expect(chunks.join('')).toBe(payload);
  });
});

describe('single-payment-builder > buildAllocationMetadata', () => {
  const productIdsForMany = (rows: { sellerId: string }[]) => {
    const map: Record<string, string[]> = {};
    rows.forEach((r, i) => {
      // For chunked-product-correctness tests, give a seller up to 30 products
      // and vary the count per seller so chunking is exercised meaningfully.
      map[r.sellerId] = Array.from(
        { length: 5 + (i % 4) },
        (_, j) => `p_${r.sellerId}_${j}`,
      );
    });
    return map;
  };

  it('embeds allocation rows + per-seller productIds as chunked JSON with a chunk-count key', () => {
    const allocation = buildAllocation([
      { shipmentId: 'ship_a', subtotalCents: 100_000, shippingCents: 20_000 },
      { shipmentId: 'ship_b', subtotalCents: 80_000, shippingCents: 15_000 },
    ]);
    const sellerProductIds = {
      seller_0: ['p1'],
      seller_1: ['p2', 'p3'],
    };

    const meta = buildAllocationMetadata(allocation, sellerProductIds);

    expect(meta.allocation_chunk_count).toBe('1');
    expect(meta.allocation_json_0).toBeDefined();
    const reconstructed = JSON.parse(
      [meta.allocation_json_0].join(''),
    ) as unknown as { rows: Array<{ sellerId: string; productIds: string[] }> };
    expect(reconstructed.rows).toHaveLength(2);
    expect(reconstructed.rows[0].productIds).toEqual(['p1']);
    expect(reconstructed.rows[1].productIds).toEqual(['p2', 'p3']);
  });

  it('chunk count grows when allocation JSON (rows + productIds) exceeds the value limit', () => {
    const allocation = buildAllocation(
      Array.from({ length: 12 }, (_, i) => ({
        shipmentId: `ship_${i}`,
        subtotalCents: 1_500_000 + i * 10_000,
        shippingCents: 30_000,
      })),
    );
    const sellerProductIds = productIdsForMany(allocation.rows);

    const meta = buildAllocationMetadata(allocation, sellerProductIds);
    const count = Number(meta.allocation_chunk_count);
    expect(count).toBeGreaterThan(1);
    const joined = Array.from({ length: count }, (_, i) => meta[`allocation_json_${i}`]);
    // Metadata stores a COMPACT allocation projection (rows only, no aggregate
    // totals — the totals travel as individual metadata keys); verify it
    // round-trips to that compact shape, NOT the full CheckoutAllocation. The
    // compact row now carries productIds so the webhook can build order_items
    // from the single reassembled allocation blob.
    expect(JSON.parse(joined.join(''))).toEqual({
      rows: allocation.rows.map((r) => ({
        sellerId: r.sellerId,
        shipmentId: r.shipmentId,
        productIds: sellerProductIds[r.sellerId],
        grossCents: r.grossCents,
        commissionCents: r.commissionCents,
        shippingCents: r.shippingCents,
        seguroCents: r.seguroCents,
        netCents: r.netCents,
      })),
    });
    // never exceeds the stripe metadata VALUE limit on any single key
    for (const v of joined) {
      expect(v.length).toBeLessThanOrEqual(STRIPE_ALLOCATION_VALUE_MAX_LEN);
    }
    // never exceeds the 50-key metadata slot budget across allocation keys
    expect(count + 1).toBeLessThanOrEqual(45);
  });

  it('does NOT emit redundant top-level seller_ids / shipment_ids / seller_product_ids metadata keys', () => {
    // Review blocker #3: those three can each exceed Stripe's 500-char value
    // limit for many sellers / many products (sellerProductIds map is a tree).
    // sellerIds and shipmentIds are derivable from the (chunked) allocation
    // rows; productIds are folded into the chunked rows too. So the top-level
    // redundant keys are removed — Phase 4 reassembly still pulls every id out
    // of the single chunked allocation_json blob.
    const allocation = buildAllocation(
      Array.from({ length: 14 }, (_, i) => ({
        shipmentId: `ship_${i}`,
        subtotalCents: 100_000 + i * 1_000,
        shippingCents: 12_000,
      })),
    );
    const sellerProductIds = productIdsForMany(allocation.rows);

    const meta = buildAllocationMetadata(allocation, sellerProductIds);

    expect(meta).not.toHaveProperty('seller_ids');
    expect(meta).not.toHaveProperty('shipment_ids');
    expect(meta).not.toHaveProperty('seller_product_ids');
    // Every metadata value fits Stripe's per-value 500-char cap — including
    // for many sellers x per-seller products.
    for (const v of Object.values(meta)) {
      expect(v.length).toBeLessThanOrEqual(STRIPE_ALLOCATION_VALUE_MAX_LEN);
    }
    // The single chunked allocation blob carries the full durable allocation
    // (seller + shipment + product ids + per-shipment money breakdown).
    const count = Number(meta.allocation_chunk_count);
    const joined = Array.from({ length: count }, (_, i) => meta[`allocation_json_${i}`]);
    const reconstructed = JSON.parse(joined.join('')) as unknown as {
      rows: Array<{ sellerId: string; shipmentId: string; productIds: string[] }>;
    };
    expect(reconstructed.rows).toHaveLength(14);
    expect(reconstructed.rows.every((r) => r.productIds.length > 0)).toBe(true);
  });
});

describe('single-payment-builder > buildSinglePaymentIntentParams', () => {
  const baseCtx = () => ({
    orderId: '11111111-2222-3333-4444-555555555555',
    buyerId: 'b_1',
    customerId: 'cus_1',
    addressId: 'a_1',
    transferGroup: 'selene_order_11111111-2222-3333-4444-555555555555',
    sellerProductIds: {} as Record<string, string[]>,
  });

  it('creates exactly one platform PaymentIntent for the buyer total', () => {
    const allocation = buildAllocation([
      { shipmentId: 'ship_a', subtotalCents: 100_000, shippingCents: 20_000 },
      { shipmentId: 'ship_b', subtotalCents: 80_000, shippingCents: 15_000 },
    ]);
    const ctx = baseCtx();
    ctx.sellerProductIds = { seller_0: ['p1'], seller_1: ['p2', 'p3'] };

    const params = buildSinglePaymentIntentParams({ allocation, ...ctx });

    // Buyer total = one order-level gross-up shared across sellers.
    expect(params.amount).toBe(188_208);
    expect(params.currency).toBe('mxn');
    expect(params.customer).toBe('cus_1');
  });

  it('omits transfer_data.destination and application_fee_amount (no seller routing at PI time)', () => {
    const allocation = buildAllocation([
      { shipmentId: 'ship_a', subtotalCents: 100_000, shippingCents: 20_000 },
    ]);
    const ctx = baseCtx();

    const params = buildSinglePaymentIntentParams({
      allocation,
      ...ctx,
    }) as unknown as Record<string, unknown>;

    expect(params.transfer_data).toBeUndefined();
    expect(params.application_fee_amount).toBeUndefined();
    // Top-level transfer_group mirrors metadata so Stripe groups later Transfers
    // to this buyer charge — separate from the metadata copy the webhook persists.
    expect(params.transfer_group).toBe(ctx.transferGroup);
    // Payment methods are dynamic/automatic per Stripe skill; no hardcoded
    // payment_method_types on this non-Terminal flow.
    expect(params.payment_method_types).toBeUndefined();
    expect((params as { automatic_payment_methods?: { enabled: boolean } }).automatic_payment_methods).toEqual({
      enabled: true,
    });
  });

  it('embeds transfer_group, flow, order ids, buyer/address ids and allocation totals in metadata', () => {
    const allocation = buildAllocation([
      { shipmentId: 'ship_a', subtotalCents: 100_000, shippingCents: 20_000 },
      { shipmentId: 'ship_b', subtotalCents: 80_000, shippingCents: 15_000 },
    ]);
    const ctx = baseCtx();
    ctx.sellerProductIds = { seller_0: ['p1'], seller_1: ['p2', 'p3'] };

    const params = buildSinglePaymentIntentParams({ allocation, ...ctx });
    const m = params.metadata;

    expect(m.app_name).toBe('selene');
    expect(m.flow).toBe(SINGLE_MODAL_FLOW);
    expect(m.transfer_group).toBe(ctx.transferGroup);
    expect(m.order_id).toBe(ctx.orderId);
    expect(m.order_group_id).toBe(ctx.orderId);
    expect(m.buyer_id).toBe('b_1');
    expect(m.address_id).toBe('a_1');
    expect(m.total_sellers).toBe('2');
    expect(m.buyer_total_cents).toBe(String(allocation.buyerTotalCents));
    expect(m.grossed_up_total_cents).toBe(String(allocation.buyerTotalCents));
    expect(m.domestic_seguro_cents).toBe(String(allocation.totalSeguroCents));
    expect(m.total_gross_cents).toBe(String(allocation.totalGrossCents));
    expect(m.total_commission_cents).toBe(String(allocation.totalCommissionCents));
    expect(m.total_shipping_cents).toBe(String(allocation.totalShippingCents));
    expect(m.total_seguro_cents).toBe(String(allocation.totalSeguroCents));
    expect(m.total_release_cents).toBe(String(allocation.totalReleaseCents));
    // Review blocker #3: seller_ids / shipment_ids / seller_product_ids are
    // NO LONGER top-level metadata keys — they fold into the chunked
    // allocation rows so no single metadata value can exceed Stripe's 500-char
    // cap. They remain reachable via the single reassembled allocation_json.
    expect(m).not.toHaveProperty('seller_ids');
    expect(m).not.toHaveProperty('shipment_ids');
    expect(m).not.toHaveProperty('seller_product_ids');
    const count = Number(m.allocation_chunk_count);
    const joined = Array.from({ length: count }, (_, i) => m[`allocation_json_${i}`]);
    const reconstructed = JSON.parse(joined.join('')) as unknown as {
      rows: Array<{
        sellerId: string;
        shipmentId: string;
        productIds: string[];
        shippingCents: number;
      }>;
    };
    expect(reconstructed.rows.map((r) => r.sellerId)).toEqual(['seller_0', 'seller_1']);
    expect(reconstructed.rows.map((r) => r.shipmentId)).toEqual(['ship_a', 'ship_b']);
    expect(reconstructed.rows[0].productIds).toEqual(['p1']);
    expect(reconstructed.rows[1].productIds).toEqual(['p2', 'p3']);
    // Every metadata value remains within the Stripe 500-char value cap.
    for (const v of Object.values(m)) {
      expect(v.length).toBeLessThanOrEqual(STRIPE_ALLOCATION_VALUE_MAX_LEN);
    }
  });

  it('triangulates: single-seller cart produces the same shape with one seller/shipment', () => {
    const allocation = buildAllocation([
      { shipmentId: 'ship_only', subtotalCents: 60_000, shippingCents: 12_000 },
    ]);
    const ctx = baseCtx();
    ctx.sellerProductIds = { seller_0: ['p_solo'] };

    const params = buildSinglePaymentIntentParams({ allocation, ...ctx });

    // Buyer total follows the shared gross-up helper.
    expect(params.amount).toBe(62_978);
    expect(params.metadata.total_sellers).toBe('1');
    // Single-seller shape: the chunked allocation blob carries the one
    // shipment + its product ids (no top-level shipment_ids metadata key).
    const count = Number(params.metadata.allocation_chunk_count);
    const joined = Array.from({ length: count }, (_, i) =>
      params.metadata[`allocation_json_${i}`],
    );
    const reconstructed = JSON.parse(joined.join('')) as unknown as {
      rows: Array<{ shipmentId: string; productIds: string[] }>;
    };
    expect(reconstructed.rows.map((r) => r.shipmentId)).toEqual(['ship_only']);
    expect(reconstructed.rows[0].productIds).toEqual(['p_solo']);
    const paramsRecord = params as unknown as Record<string, unknown>;
    expect(paramsRecord.transfer_data).toBeUndefined();
    expect(paramsRecord.application_fee_amount).toBeUndefined();
  });

  it('matches the frontend order summary total for the same cart', () => {
    const allocation = buildAllocation([
      { shipmentId: 'ship_a', subtotalCents: 100_000, shippingCents: 20_000 },
      { shipmentId: 'ship_b', subtotalCents: 80_000, shippingCents: 15_000 },
    ]);
    const ctx = baseCtx();
    const params = buildSinglePaymentIntentParams({ allocation, ...ctx });
    const frontendSummary = calculateOrderCalculations([
      { id: 'item-a', price: 1_000 },
      { id: 'item-b', price: 800 },
    ] as never);

    expect(params.amount).toBe(frontendSummary.totalInCents);
    expect(frontendSummary.totalInCents).toBe(allocation.buyerTotalCents);
  });

  it('produces BYTE-DETERMINISTIC metadata regardless of allocation row input order', () => {
    // Review blocker #2 residual: deterministic shipment ids are not enough —
    // the Stripe PaymentIntent create body (metadata.allocation_json) must be
    // byte-identical across retries of the SAME cart, or Stripe rejects
    // idempotency-key reuse with different params. Allocation row order in
    // index.ts depends on DB product-fetch order (non-deterministic), so the
    // builder MUST normalize row order before emitting metadata.
    //
    // Build the SAME cart twice — same {sellerId -> shipment/costs/productIds}
    // content — but pass the rows to the calculator in two different orders.
    const buildCart = (order: 'forward' | 'reversed'): CheckoutAllocation => {
      const specs = [
        { sellerId: 'seller_2', shipmentId: 'ship_c', subtotalCents: 40_000, shippingCents: 5_000 },
        { sellerId: 'seller_0', shipmentId: 'ship_b', subtotalCents: 80_000, shippingCents: 15_000 },
        { sellerId: 'seller_1', shipmentId: 'ship_a', subtotalCents: 100_000, shippingCents: 20_000 },
      ];
      const rows = order === 'forward' ? specs : [...specs].reverse();
      const allocation = calculateCheckoutAllocation(
        rows.map((r) => ({
          sellerId: r.sellerId,
          shipmentId: r.shipmentId,
          subtotalCents: r.subtotalCents,
          shippingCents: r.shippingCents,
        })),
      );
      assertValidCheckoutAllocation(allocation);
      return allocation;
    };
    const ctx = baseCtx();
    ctx.sellerProductIds = {
      seller_0: ['pa', 'pb'],
      seller_1: ['pc'],
      seller_2: ['pd', 'pe', 'pf'],
    };

    const paramsForward = buildSinglePaymentIntentParams({
      allocation: buildCart('forward'),
      ...ctx,
    });
    const paramsReversed = buildSinglePaymentIntentParams({
      allocation: buildCart('reversed'),
      ...ctx,
    });

    // Total amounts must match (order-independent aggregation).
    expect(paramsForward.amount).toBe(paramsReversed.amount);
    // Metadata must be byte-for-byte identical, including the chunked
    // allocation_json payload, so Stripe idempotency reuse is safe.
    expect(paramsForward.metadata).toEqual(paramsReversed.metadata);
    // And the reassembled rows come out in a STABLE, normalized (sorted by
    // sellerId) order — not whatever order the DB happened to return.
    const reconstructed = JSON.parse(
      Array.from(
        { length: Number(paramsForward.metadata.allocation_chunk_count) },
        (_, i) => paramsForward.metadata[`allocation_json_${i}`],
      ).join(''),
    ) as unknown as { rows: Array<{ sellerId: string }> };
    expect(reconstructed.rows.map((r) => r.sellerId)).toEqual([
      'seller_0',
      'seller_1',
      'seller_2',
    ]);
  });

  it('produces BYTE-DETERMINISTIC metadata when the same seller productIds arrive in different ORDER', () => {
    // Phase 3 residual blocker: row-order normalization (sorted by sellerId)
    // is not enough — the per-seller productIds array comes from a DB
    // `.in('id', productIds)` fetch whose RETURN ORDER IS NOT GUARANTEED. A
    // retry of the same cart can reassemble each seller's productIds in a
    // different order, which yields a different `allocation_json` metadata
    // blob and trips Stripe's idempotency-key reuse-with-different-body
    // rejection. The builder MUST normalize productIds per row (sorted) so
    // the Stripe PaymentIntent create body is byte-deterministic for a given
    // cart regardless of DB product-fetch order.
    //
    // Same cart content: 3 sellers, each with 2-3 products. Two passes pass
    // the SAME productIds SET per seller but in DIFFERENT array order.
    const allocation = buildAllocation([
      { shipmentId: 'ship_a', subtotalCents: 100_000, shippingCents: 20_000 },
      { shipmentId: 'ship_b', subtotalCents: 80_000, shippingCents: 15_000 },
      { shipmentId: 'ship_c', subtotalCents: 40_000, shippingCents: 5_000 },
    ]);
    const ctx = baseCtx();

    const forwardProductIds: Record<string, string[]> = {
      seller_0: ['p_a', 'p_b', 'p_c'],
      seller_1: ['p_d', 'p_e'],
      seller_2: ['p_f', 'p_g', 'p_h'],
    };
    const shuffledProductIds: Record<string, string[]> = {
      seller_0: ['p_c', 'p_a', 'p_b'],
      seller_1: ['p_e', 'p_d'],
      seller_2: ['p_h', 'p_f', 'p_g'],
    };

    const paramsForward = buildSinglePaymentIntentParams({
      allocation,
      ...ctx,
      sellerProductIds: forwardProductIds,
    });
    const paramsShuffled = buildSinglePaymentIntentParams({
      allocation,
      ...ctx,
      sellerProductIds: shuffledProductIds,
    });

    // The entire Stripe PaymentIntent create body must be byte-identical
    // across retries of the same cart, including every metadata value and
    // the chunked allocation_json payload.
    expect(paramsForward).toEqual(paramsShuffled);
    expect(paramsForward.metadata).toEqual(paramsShuffled.metadata);

    // The reassembled allocation rows carry productIds in a STABLE,
    // normalized (sorted) order — not whatever order the DB returned.
    const reconstructed = JSON.parse(
      Array.from(
        { length: Number(paramsForward.metadata.allocation_chunk_count) },
        (_, i) => paramsForward.metadata[`allocation_json_${i}`],
      ).join(''),
    ) as unknown as { rows: Array<{ productIds: string[] }> };
    expect(reconstructed.rows[0].productIds).toEqual(['p_a', 'p_b', 'p_c']);
    expect(reconstructed.rows[1].productIds).toEqual(['p_d', 'p_e']);
    expect(reconstructed.rows[2].productIds).toEqual(['p_f', 'p_g', 'p_h']);
  });
});

describe('single-payment-builder > assertReservationSucceeded', () => {
  it('does not throw when the RPC reports success: true with no error', () => {
    expect(() =>
      assertReservationSucceeded({
        data: { success: true } as ReservationResult,
        error: null,
      }),
    ).not.toThrow();
  });

  it('accepts the Supabase RPC array shape when the first row reports success: true', () => {
    expect(() =>
      assertReservationSucceeded({
        data: [{ success: true } as ReservationResult],
        error: null,
      }),
    ).not.toThrow();
  });

  it('throws RESERVATION_FAILED when the Supabase RPC array shape reports success: false', () => {
    expect(() =>
      assertReservationSucceeded({
        data: [{ success: false } as ReservationResult],
        error: null,
      }),
    ).toThrow('RESERVATION_FAILED');
  });

  it('throws RESERVATION_FAILED when the RPC returned a Postgrest error', () => {
    expect(() =>
      assertReservationSucceeded({
        data: null,
        error: { message: 'failed to reserve' },
      }),
    ).toThrow('RESERVATION_FAILED');
  });

  it('throws RESERVATION_FAILED when the RPC returned { success: false } without an error', () => {
    // fn_reserve_products can soft-fail (e.g. a product was already sold) by
    // returning { success: false } and NO thrown error. The previous wiring
    // only checked `reserveError` and let PI creation proceed — this is the
    // blocker regression the correct cycle repairs.
    expect(() =>
      assertReservationSucceeded({
        data: { success: false } as ReservationResult,
        error: null,
      }),
    ).toThrow('RESERVATION_FAILED');
  });

  it('triangulates: throws RESERVATION_FAILED when the RPC returned no data AND no error', () => {
    expect(() =>
      assertReservationSucceeded({ data: null, error: null }),
    ).toThrow('RESERVATION_FAILED');
  });
});

describe('single-payment-builder > normalizeCreateConnectPaymentRequest', () => {
  it('normalizes items[].productId payloads into a deduped product id list', () => {
    const normalized = normalizeCreateConnectPaymentRequest({
      addressId: 'addr_1',
      idempotencyKey: 'idem_1',
      items: [
        { productId: 'gpu-1', quantity: 1 },
        { productId: 'cpu-1', quantity: 1 },
        { productId: 'gpu-1', quantity: 1 },
      ],
    });

    expect(normalized).toEqual({
      addressId: 'addr_1',
      idempotencyKey: 'idem_1',
      productIds: ['gpu-1', 'cpu-1'],
    });
  });

  it('triangulates: accepts legacy productIds payloads and preserves first-seen order', () => {
    const normalized = normalizeCreateConnectPaymentRequest({
      addressId: 'addr_2',
      productIds: ['gpu-2', 'cpu-2', 'gpu-2'],
    });

    expect(normalized).toEqual({
      addressId: 'addr_2',
      idempotencyKey: undefined,
      productIds: ['gpu-2', 'cpu-2'],
    });
  });
});

describe('single-payment-builder > buildCheckoutIdentifiers', () => {
  const dummyRandomUuid = (): string => '00000000-0000-4000-8000-000000000000';

  it('derives DETERMINISTIC identifiers from the idempotency key (no randomness)', () => {
    const a = buildCheckoutIdentifiers('checkout-key-abc', dummyRandomUuid);
    const b = buildCheckoutIdentifiers('checkout-key-abc', dummyRandomUuid);

    expect(a.orderGroupId).toBe(b.orderGroupId);
    expect(a.transferGroup).toBe(b.transferGroup);
    expect(a.shipmentIdFor('seller_x')).toBe(b.shipmentIdFor('seller_x'));
    // The injected random source must NOT be consulted in deterministic mode;
    // assert the order group id differs from the dummy fixed uuid.
    expect(a.orderGroupId).not.toBe(dummyRandomUuid());
  });

  it('triangulates: different idempotency keys yield different group ids', () => {
    const a = buildCheckoutIdentifiers('key-one', dummyRandomUuid);
    const b = buildCheckoutIdentifiers('key-two', dummyRandomUuid);
    expect(a.orderGroupId).not.toBe(b.orderGroupId);
    expect(a.transferGroup).not.toBe(b.transferGroup);
  });

  it('produces collision-free shipment ids per seller for the same idempotency key', () => {
    const ids = buildCheckoutIdentifiers('shared-key', dummyRandomUuid);
    expect(ids.shipmentIdFor('seller_a')).not.toBe(ids.shipmentIdFor('seller_b'));
    // Stable on retrial per seller — required so the webhook persists the same
    // shipment id on a retry without duplicating shipments.
    const again = buildCheckoutIdentifiers('shared-key', dummyRandomUuid);
    expect(again.shipmentIdFor('seller_a')).toBe(ids.shipmentIdFor('seller_a'));
  });

  it('emits RFC-4122-formatted 36-char ids derived from the idempotency key', () => {
    const ids = buildCheckoutIdentifiers('checkout-key-1', dummyRandomUuid);
    expect(ids.orderGroupId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(ids.shipmentIdFor('s_1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // transfer_group is Stripe-safe (<=100 chars) and carries the group id.
    expect(ids.transferGroup).toBe(`selene_order_${ids.orderGroupId}`);
    expect(ids.transferGroup.length).toBeLessThanOrEqual(100);
  });

  it('falls back to the injected random id generator when no idempotency key is provided', () => {
    let calls = 0;
    const countingRandom = (): string => {
      calls += 1;
      return `random-${calls}`;
    };
    const ids = buildCheckoutIdentifiers(undefined, countingRandom);
    expect(ids.orderGroupId).toBe('random-1');
    expect(ids.transferGroup).toBe('selene_order_random-1');
    expect(ids.shipmentIdFor('s_a')).toBe('random-2');
  });

  it('rejects an empty-string idempotency key (unsafe: would collide all retries)', () => {
    expect(() => buildCheckoutIdentifiers('', dummyRandomUuid)).toThrow();
  });
});

describe('single-payment-builder > buildCreateConnectPaymentResponse', () => {
  it('returns a single-secret response with the order-level transfer_group', () => {
    const ctx = {
      orderId: '11111111-2222-3333-4444-555555555555',
      customerId: 'cus_1',
      ephemeralKeySecret: 'ek_secret_1',
      transferGroup: 'selene_order_11111111-2222-3333-4444-555555555555',
    };
    const pi = { client_secret: 'pi_secret_x', amount: 187_800 } as const;

    const response = buildCreateConnectPaymentResponse(pi, ctx);

    expect(response).toEqual({
      orderId: ctx.orderId,
      clientSecret: 'pi_secret_x',
      customer: 'cus_1',
      ephemeralKey: 'ek_secret_1',
      amount: 187_800,
      transferGroup: ctx.transferGroup,
    });
  });

  it('never exposes a per-seller paymentIntents array in the response', () => {
    const ctx = {
      orderId: 'o_1',
      customerId: 'cus_1',
      ephemeralKeySecret: 'ek_1',
      transferGroup: 'selene_order_o_1',
    };
    const pi = { client_secret: 'cs_1', amount: 5000 } as const;

    const response = buildCreateConnectPaymentResponse(pi, ctx);

    expect(response).not.toHaveProperty('paymentIntents');
    expect((response as unknown as Record<string, unknown>).paymentIntents).toBeUndefined();
    expect(response.clientSecret).toBe('cs_1');
  });
});
