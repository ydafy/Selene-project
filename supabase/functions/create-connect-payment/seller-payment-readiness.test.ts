import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSellersNotReadyForPayment } from './seller-payment-readiness.ts';

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

describe('create-connect-payment seller readiness wiring', () => {
  const source = readFileSync(
    join(process.cwd(), 'supabase/functions/create-connect-payment/index.ts'),
    'utf8',
  );

  it('loads onboarding status and gates sellers before creating the PaymentIntent', () => {
    expect(source).toContain(
      ".select('id, stripe_account_id, stripe_onboarding_status')",
    );
    const gate = source.indexOf('findSellersNotReadyForPayment(');
    const paymentIntent = source.indexOf('createSinglePaymentIntent({');
    expect(gate).toBeGreaterThan(-1);
    expect(paymentIntent).toBeGreaterThan(gate);
  });

  it('releases reserved products and keeps the SELLER_NOT_ONBOARDED contract', () => {
    const gate = source.indexOf('findSellersNotReadyForPayment(');
    const block = source.slice(gate, gate + 600);
    expect(block).toContain("releaseReserved('SELLER_NOT_ONBOARDED')");
    expect(block).toContain("throw new Error('SELLER_NOT_ONBOARDED')");
  });
});
