import { describe, expect, it } from 'bun:test';

import {
  ADDRESS_ID,
  PRODUCT_1,
  allocationRowsFromMetadata,
  moneyEffects,
  productRow,
  runCreateConnectPayment,
} from './handler-fakes.ts';

type PaymentIntentParams = { metadata: Record<string, string> };

describe('Connect money-flow guards', () => {
  it('Connect PaymentIntent metadata includes buyer address id', async () => {
    const result = await runCreateConnectPayment();

    expect(result.status).toBe(200);
    const params = result.paymentIntentsCreate[0][0] as PaymentIntentParams;
    expect(params.metadata.address_id).toBe(ADDRESS_ID);
  });

  it('Connect PaymentIntent metadata carries the seller shipping deduction from the publication snapshot', async () => {
    const result = await runCreateConnectPayment({
      products: [productRow({ publication_shipping_reserve_cents: 17_500 })],
    });

    expect(result.status).toBe(200);
    const params = result.paymentIntentsCreate[0][0] as PaymentIntentParams;
    expect(allocationRowsFromMetadata(params.metadata)[0].shippingCents).toBe(
      17_500,
    );
    expect(params.metadata.total_shipping_cents).toBe('17500');
    expect(params.metadata).not.toHaveProperty(
      'seller_shipping_deduction_cents',
    );
  });

  it('Connect PaymentIntent rejects quantity above one for single-product listings', async () => {
    const result = await runCreateConnectPayment({
      body: {
        items: [{ productId: PRODUCT_1, quantity: 2 }],
        addressId: ADDRESS_ID,
      },
    });

    expect(result.status).toBe(400);
    expect(String(result.body.error)).toContain('quantity');
    expect(result.rpcs).toEqual([]);
    expect(result.queries).toEqual([]);
    expect(moneyEffects(result)).toEqual({
      customers: 0,
      ephemeralKeys: 0,
      paymentIntents: 0,
      writes: 0,
    });
  });
});
