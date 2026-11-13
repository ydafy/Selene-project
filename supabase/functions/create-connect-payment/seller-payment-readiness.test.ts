import { describe, expect, it } from 'bun:test';
import { findSellersNotReadyForPayment } from './seller-payment-readiness.ts';
import {
  ADDRESS_ID,
  BUYER_ID,
  PRODUCT_1,
  PRODUCT_2,
  SELLER_A,
  SELLER_B,
  moneyEffects,
  productRow,
  readySeller,
  runCreateConnectPayment,
} from './handler-fakes.ts';

describe('findSellersNotReadyForPayment', () => {
  it('accepts sellers with a Connect account and complete onboarding', () => {
    expect(
      findSellersNotReadyForPayment(
        ['seller-a'],
        [
          {
            id: 'seller-a',
            stripe_account_id: 'acct_a',
            stripe_onboarding_status: 'complete',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('rejects sellers whose Connect account exists but onboarding is pending or rejected', () => {
    expect(
      findSellersNotReadyForPayment(
        ['seller-a', 'seller-b', 'seller-c'],
        [
          {
            id: 'seller-a',
            stripe_account_id: 'acct_a',
            stripe_onboarding_status: 'pending',
          },
          {
            id: 'seller-b',
            stripe_account_id: 'acct_b',
            stripe_onboarding_status: 'rejected',
          },
          {
            id: 'seller-c',
            stripe_account_id: 'acct_c',
            stripe_onboarding_status: null,
          },
        ],
      ),
    ).toEqual(['seller-a', 'seller-b', 'seller-c']);
  });

  it('rejects sellers without a Connect account, even if marked complete', () => {
    expect(
      findSellersNotReadyForPayment(
        ['seller-a'],
        [
          {
            id: 'seller-a',
            stripe_account_id: null,
            stripe_onboarding_status: 'complete',
          },
        ],
      ),
    ).toEqual(['seller-a']);
  });

  it('rejects sellers with no profile row', () => {
    expect(findSellersNotReadyForPayment(['seller-a'], [])).toEqual([
      'seller-a',
    ]);
  });

  it('reports only the sellers that are not ready in a multi-seller order', () => {
    expect(
      findSellersNotReadyForPayment(
        ['seller-a', 'seller-b'],
        [
          {
            id: 'seller-a',
            stripe_account_id: 'acct_a',
            stripe_onboarding_status: 'complete',
          },
          {
            id: 'seller-b',
            stripe_account_id: 'acct_b',
            stripe_onboarding_status: 'pending',
          },
        ],
      ),
    ).toEqual(['seller-b']);
  });
});

describe('create-connect-payment seller readiness gate', () => {
  const twoSellers = {
    body: { productIds: [PRODUCT_1, PRODUCT_2], addressId: ADDRESS_ID },
    products: [
      productRow(),
      productRow({ id: PRODUCT_2, seller_id: SELLER_B }),
    ],
  };

  it('loads the onboarding status of every seller once', async () => {
    const result = await runCreateConnectPayment({
      ...twoSellers,
      products: [
        productRow(),
        productRow({ id: PRODUCT_2, seller_id: SELLER_A }),
      ],
    });

    expect(result.status).toBe(200);
    expect(result.queries[2]).toEqual({
      table: 'profiles_private',
      ops: [
        ['select', 'id, stripe_account_id, stripe_onboarding_status'],
        ['in', 'id', [SELLER_A]],
      ],
    });
  });

  for (const [label, sellerProfiles] of [
    [
      'a pending seller',
      [
        readySeller(SELLER_A),
        { ...readySeller(SELLER_B), stripe_onboarding_status: 'pending' },
      ],
    ],
    ['a seller without a profile', [readySeller(SELLER_A)]],
    [
      'a seller without a Connect account',
      [
        readySeller(SELLER_A),
        { ...readySeller(SELLER_B), stripe_account_id: null },
      ],
    ],
  ] as const) {
    it(`blocks ${label} with SELLER_NOT_ONBOARDED, releases the reservation, and never charges`, async () => {
      const result = await runCreateConnectPayment({
        ...twoSellers,
        sellerProfiles: [...sellerProfiles],
      });

      expect(result.status).toBe(400);
      expect(result.body).toEqual({ error: 'SELLER_NOT_ONBOARDED' });
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
      expect(result.calls.at(-1)).toBe('rpc:fn_release_products');
      expect(moneyEffects(result)).toEqual({
        customers: 0,
        ephemeralKeys: 0,
        paymentIntents: 0,
        writes: 0,
      });
    });
  }

  it('blocks when the profiles query returns no rows', async () => {
    const result = await runCreateConnectPayment({ sellerProfiles: null });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'SELLER_NOT_ONBOARDED' });
    expect(result.paymentIntentsCreate).toEqual([]);
  });
});
