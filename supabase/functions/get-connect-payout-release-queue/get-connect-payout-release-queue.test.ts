import { describe, expect, it } from 'bun:test';

import {
  buildConnectPayoutReleaseQueue,
  assertAdminProfile,
  type ConnectPayoutReleaseQueueRow,
} from './get-connect-payout-release-queue';

const row = (
  overrides: Partial<ConnectPayoutReleaseQueueRow> = {},
): ConnectPayoutReleaseQueueRow => ({
  shipment_id: 'shipment-1',
  seller_id: 'seller-1',
  seller_name: 'Ada Seller',
  order_id: 'order-1',
  status: 'completed',
  completed_at: '2026-06-21T12:00:00.000Z',
  is_eligible: true,
  ineligible_reason: null,
  release_amount_cents: 10_000,
  stripe_account_id: 'acct_seller_1',
  stripe_onboarding_status: 'complete',
  stripe_payment_intent_id: 'pi_123',
  ...overrides,
});

describe('buildConnectPayoutReleaseQueue', () => {
  it('groups eligible shipments by seller and sums release amounts', () => {
    expect(
      buildConnectPayoutReleaseQueue([
        row({ shipment_id: 'shipment-1', release_amount_cents: 10_000 }),
        row({ shipment_id: 'shipment-2', release_amount_cents: 4_500 }),
      ]),
    ).toEqual({
      success: true,
      eligibleBatches: [
        {
          sellerId: 'seller-1',
          sellerName: 'Ada Seller',
          stripeAccountId: 'acct_seller_1',
          releaseAmountCents: 14_500,
          shipmentIds: ['shipment-1', 'shipment-2'],
          shipments: [
            row({ shipment_id: 'shipment-1', release_amount_cents: 10_000 }),
            row({ shipment_id: 'shipment-2', release_amount_cents: 4_500 }),
          ],
        },
      ],
      rejected: [],
    });
  });

  it('returns rejected shipment reasons without mixing them into eligible batches', () => {
    expect(
      buildConnectPayoutReleaseQueue([
        row({ shipment_id: 'shipment-1' }),
        row({
          shipment_id: 'shipment-2',
          is_eligible: false,
          ineligible_reason: 'active_dispute',
        }),
      ]),
    ).toEqual({
      success: true,
      eligibleBatches: [
        {
          sellerId: 'seller-1',
          sellerName: 'Ada Seller',
          stripeAccountId: 'acct_seller_1',
          releaseAmountCents: 10_000,
          shipmentIds: ['shipment-1'],
          shipments: [row({ shipment_id: 'shipment-1' })],
        },
      ],
      rejected: [
        {
          shipmentId: 'shipment-2',
          sellerId: 'seller-1',
          sellerName: 'Ada Seller',
          reason: 'active_dispute',
          releaseAmountCents: 10_000,
        },
      ],
    });
  });
});

describe('assertAdminProfile', () => {
  it('rejects non-admin queue callers', () => {
    expect(() => assertAdminProfile({ role: 'user' })).toThrow(
      'ADMIN_REQUIRED',
    );
  });
});
