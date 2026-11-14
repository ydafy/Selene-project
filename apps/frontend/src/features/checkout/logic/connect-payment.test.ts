import { describe, expect, it } from 'bun:test';

import {
  buildConnectPaymentRequest,
  calculateSeguroSelene,
  normalizeConnectPaymentResponse,
} from './connect-payment';

describe('connect payment helpers', () => {
  it('builds the create-connect-payment payload from cart items and address', () => {
    const payload = buildConnectPaymentRequest({
      addressId: 'addr-1',
      idempotencyKey: 'idem-1',
      items: [
        { id: 'gpu-1', seller_id: 'seller-a', price_cents: 50_000 },
        { id: 'cpu-1', seller_id: 'seller-b', price_cents: 30_000 },
        { id: 'gpu-1', seller_id: 'seller-a', price_cents: 50_000 },
      ],
    });

    expect(payload).toEqual({
      items: [
        { productId: 'gpu-1', quantity: 1 },
        { productId: 'cpu-1', quantity: 1 },
      ],
      addressId: 'addr-1',
      idempotencyKey: 'idem-1',
    });
  });

  it('normalizes the single-secret Connect response shape', () => {
    const normalized = normalizeConnectPaymentResponse({
      orderId: 'order-1',
      customer: 'cus_123',
      ephemeralKey: 'eph_123',
      clientSecret: 'pi_secret',
      amount: 85_100,
      transferGroup: 'grp_order-1',
    });

    expect(normalized).toEqual({
      orderId: 'order-1',
      customer: 'cus_123',
      ephemeralKey: 'eph_123',
      clientSecret: 'pi_secret',
      amount: 85_100,
      transferGroup: 'grp_order-1',
    });
  });

  it('rejects the legacy per-seller paymentIntents array shape', () => {
    const legacy = {
      orderId: 'order-1',
      customer: 'cus_123',
      ephemeralKey: 'eph_123',
      paymentIntents: [
        {
          sellerId: 'seller-a',
          shipmentId: 'ship-a',
          clientSecret: 'pi_a_secret',
          amount: 53_000,
          descriptor: 'Seller A',
        },
      ],
    };

    expect(() => normalizeConnectPaymentResponse(legacy as never)).toThrow();
  });

  it('rejects a single-secret response without transferGroup', () => {
    const missingGroup = {
      orderId: 'order-1',
      customer: 'cus_123',
      ephemeralKey: 'eph_123',
      clientSecret: 'pi_secret',
      amount: 85_100,
    };

    expect(() =>
      normalizeConnectPaymentResponse(missingGroup as never),
    ).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: ['transferGroup'] })],
      }),
    );
  });

  it('calculates Seguro Selene in integer cents from a cents subtotal', () => {
    expect(calculateSeguroSelene(100_000)).toBe(4_722);
  });

  it('keeps Seguro Selene calculation stable for order summary totals', () => {
    expect(calculateSeguroSelene(800)).toBe(399);
  });

  it('rejects a subtotal that is not integer cents', () => {
    expect(() => calculateSeguroSelene(1_000.5)).toThrow(
      'INVALID_STRIPE_FEE_GROSS_UP_INPUT:subtotalCents',
    );
  });
});
