import { describe, expect, it } from 'bun:test';

import {
  buildReleasePayload,
  getSelectedEligibleShipmentIds,
  groupConnectPayoutReleaseQueue,
} from './connectPayoutReleaseQueue';
import type { ConnectPayoutReleaseQueueRow } from '@selene/types';

const row = (
  overrides: Partial<ConnectPayoutReleaseQueueRow>,
): ConnectPayoutReleaseQueueRow => ({
  completed_at: '2026-06-22T10:00:00.000Z',
  ineligible_reason: null,
  is_eligible: true,
  order_id: 'order-1',
  release_amount_cents: 12500,
  seller_id: 'seller-1',
  seller_name: 'Selene Seller',
  shipment_id: 'shipment-1',
  status: 'completed',
  stripe_account_id: 'acct_123',
  stripe_onboarding_status: 'completed',
  stripe_payment_intent_id: 'pi_123',
  ...overrides,
});

describe('connect payout release queue helpers', () => {
  it('groups eligible seller shipments into release-ready batches', () => {
    const batches = groupConnectPayoutReleaseQueue([
      row({ shipment_id: 'shipment-1', release_amount_cents: 12_500 }),
      row({ shipment_id: 'shipment-2', release_amount_cents: 8_000 }),
    ]);

    expect(batches).toEqual([
      {
        sellerId: 'seller-1',
        sellerName: 'Selene Seller',
        stripeAccountId: 'acct_123',
        totalEligibleAmountCents: 20_500,
        eligibleShipmentCount: 2,
        ineligibleShipmentCount: 0,
        releaseState: 'ready',
        shipments: [
          {
            completedAt: '2026-06-22T10:00:00.000Z',
            ineligibleReason: null,
            isEligible: true,
            orderId: 'order-1',
            releaseAmountCents: 12_500,
            reconciliationIndicator: 'ready_for_release',
            shipmentId: 'shipment-1',
            status: 'completed',
            stripePaymentIntentId: 'pi_123',
          },
          {
            completedAt: '2026-06-22T10:00:00.000Z',
            ineligibleReason: null,
            isEligible: true,
            orderId: 'order-1',
            releaseAmountCents: 8_000,
            reconciliationIndicator: 'ready_for_release',
            shipmentId: 'shipment-2',
            status: 'completed',
            stripePaymentIntentId: 'pi_123',
          },
        ],
      },
    ]);
  });

  it('keeps ineligible shipments disabled with reasons and blocked indicators', () => {
    const batches = groupConnectPayoutReleaseQueue([
      row({ shipment_id: 'shipment-ready', release_amount_cents: 10_000 }),
      row({
        shipment_id: 'shipment-blocked',
        is_eligible: false,
        ineligible_reason: 'ACTIVE_DISPUTE',
        release_amount_cents: 9_000,
      }),
    ]);

    expect(batches[0]).toMatchObject({
      totalEligibleAmountCents: 10_000,
      eligibleShipmentCount: 1,
      ineligibleShipmentCount: 1,
      releaseState: 'partial',
    });
    expect(batches[0].shipments[1]).toMatchObject({
      shipmentId: 'shipment-blocked',
      isEligible: false,
      ineligibleReason: 'ACTIVE_DISPUTE',
      reconciliationIndicator: 'blocked',
    });
  });

  it('builds a release payload only from selected eligible shipments', () => {
    const batches = groupConnectPayoutReleaseQueue([
      row({ shipment_id: 'shipment-a', release_amount_cents: 10_000 }),
      row({ shipment_id: 'shipment-b', release_amount_cents: 15_000 }),
      row({
        shipment_id: 'shipment-c',
        is_eligible: false,
        ineligible_reason: 'SELLER_PAYOUT_NOT_READY',
        release_amount_cents: 20_000,
      }),
    ]);

    const selectedShipmentIds = getSelectedEligibleShipmentIds(batches[0], [
      'shipment-a',
      'shipment-c',
    ]);

    expect(selectedShipmentIds).toEqual(['shipment-a']);
    expect(
      buildReleasePayload({
        batch: batches[0],
        selectedShipmentIds,
        idempotencyKey: 'release-key-1',
      }),
    ).toEqual({
      sellerId: 'seller-1',
      shipmentIds: ['shipment-a'],
      idempotencyKey: 'release-key-1',
    });
  });

  it('marks sellers without eligible selectable shipments as blocked', () => {
    const batches = groupConnectPayoutReleaseQueue([
      row({
        shipment_id: 'shipment-blocked',
        is_eligible: false,
        ineligible_reason: 'MISSING_STRIPE_ACCOUNT',
      }),
    ]);

    expect(batches[0]).toMatchObject({
      totalEligibleAmountCents: 0,
      eligibleShipmentCount: 0,
      ineligibleShipmentCount: 1,
      releaseState: 'blocked',
    });
  });
});
