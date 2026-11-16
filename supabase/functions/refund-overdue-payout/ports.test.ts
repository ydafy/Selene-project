import { describe, expect, test } from 'bun:test';

import {
  createStripeRefundOverduePayoutPorts,
  type RefundOverduePayoutStripe,
} from './ports.ts';

// A Stripe list of refunds in pages of 100, as the SDK returns it: awaitable for the first page,
// async-iterable over every page, and autoPagingToArray with its `limit` cap.
function stripeWithRefunds(total: number, matchAt: number) {
  const refunds = Array.from({ length: total }, (_, index) => ({
    id: `re_${index}`,
    metadata: { shipment_id: index === matchAt ? 'ship-target' : 'ship-other' },
  }));
  const listed: unknown[] = [];
  const stripe = {
    refunds: {
      list: (params: { payment_intent: string; limit: number }) => {
        listed.push(params);
        const page = refunds.slice(0, params.limit);
        return Object.assign(
          Promise.resolve({ data: page, has_more: total > params.limit }),
          {
            async *[Symbol.asyncIterator]() {
              yield* refunds;
            },
            autoPagingToArray: async ({ limit }: { limit: number }) =>
              refunds.slice(0, limit),
          },
        );
      },
    },
  } as unknown as RefundOverduePayoutStripe;
  return { stripe, listed };
}

const ids = (value: unknown) =>
  (value as { id: string; metadata: { shipment_id: string } }[])
    .filter((refund) => refund.metadata.shipment_id === 'ship-target')
    .map((refund) => refund.id);

describe('refund-overdue-payout Stripe ports: listRefunds', () => {
  test('lists the refunds of the PaymentIntent and finds a match on the second page', async () => {
    const { stripe, listed } = stripeWithRefunds(150, 120);
    const listRefunds = createStripeRefundOverduePayoutPorts(
      () => stripe,
    ).listRefunds;
    expect(ids(await listRefunds('pi_overdue'))).toEqual(['re_120']);
    expect(listed).toEqual([{ payment_intent: 'pi_overdue', limit: 100 }]);
  });

  test('reads every page: a match after the first thousand refunds is still found', async () => {
    const { stripe } = stripeWithRefunds(1101, 1100);
    const listRefunds = createStripeRefundOverduePayoutPorts(
      () => stripe,
    ).listRefunds;
    const listedRefunds = await listRefunds('pi_overdue');
    expect(ids(listedRefunds)).toEqual(['re_1100']);
    expect(listedRefunds as unknown[]).toHaveLength(1101);
  });
});
