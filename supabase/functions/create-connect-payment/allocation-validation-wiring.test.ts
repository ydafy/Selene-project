import { describe, expect, it } from 'bun:test';

import {
  ADDRESS_ID,
  BUYER_ID,
  PRODUCT_1,
  PRODUCT_2,
  allocationRowsFromMetadata,
  productRow,
  runCreateConnectPayment,
} from './handler-fakes.ts';

describe('create-connect-payment allocation validation', () => {
  it('rejects a checkout whose requested product has no row before creating the PaymentIntent', async () => {
    const result = await runCreateConnectPayment({
      body: { productIds: [PRODUCT_1, PRODUCT_2], addressId: ADDRESS_ID },
      products: [productRow()],
    });

    expect(result.status).toBe(422);
    expect(result.body).toEqual({ error: 'ONE_PRODUCT_PER_SHIPMENT_REQUIRED' });
    expect(result.rpcs).toEqual([
      {
        name: 'fn_reserve_products',
        args: { p_product_ids: [PRODUCT_1, PRODUCT_2], p_buyer_id: BUYER_ID },
      },
      {
        name: 'fn_release_products',
        args: { p_product_ids: [PRODUCT_1, PRODUCT_2] },
      },
    ]);
    expect(result.calls.slice(-2)).toEqual([
      'stripe.ephemeralKeys.create',
      'rpc:fn_release_products',
    ]);
    expect(result.paymentIntentsCreate).toEqual([]);
  });

  it('prices one unit per listing and reserves a repeated listing once', async () => {
    const result = await runCreateConnectPayment({
      body: {
        items: [
          { productId: PRODUCT_1 },
          { productId: PRODUCT_1, quantity: 1 },
        ],
        addressId: ADDRESS_ID,
      },
    });

    expect(result.status).toBe(200);
    expect(result.rpcs).toEqual([
      {
        name: 'fn_reserve_products',
        args: { p_product_ids: [PRODUCT_1], p_buyer_id: BUYER_ID },
      },
    ]);
    const params = result.paymentIntentsCreate[0][0] as {
      metadata: Record<string, string>;
    };
    const rows = allocationRowsFromMetadata(params.metadata);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productIds: [PRODUCT_1],
      grossCents: 123_450,
    });
  });
});
