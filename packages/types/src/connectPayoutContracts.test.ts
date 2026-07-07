import { describe, expect, test } from 'bun:test';
import type {
  ConnectPayoutReleaseQueueRow,
  ConnectPayoutReleaseRequest,
  CreateDisputeRequest,
  EdgeFunctionRegistry,
  ReleaseConnectPayoutResponse,
} from './index';

describe('connect payout shared contracts', () => {
  test('release-connect-payout request requires seller, shipment batch, and idempotency key', () => {
    const payload = {
      sellerId: 'seller-1',
      shipmentIds: ['shipment-1', 'shipment-2'],
      idempotencyKey: 'release-key-1',
    } satisfies ConnectPayoutReleaseRequest;

    const registryPayload: EdgeFunctionRegistry['release-connect-payout']['payload'] = payload;

    expect(registryPayload).toEqual(payload);
  });

  test('release-connect-payout response is a discriminated success/error contract', () => {
    const paid = {
      success: true,
      runId: 'run-1',
      stripePayoutId: 'po_123',
      status: 'paid',
      amount: 123_45,
    } satisfies ReleaseConnectPayoutResponse;

    const failed = {
      success: false,
      error: 'Ineligible shipment requested',
    } satisfies ReleaseConnectPayoutResponse;

    expect(paid.status).toBe('paid');
    expect(failed.error).toBe('Ineligible shipment requested');
  });

  test('release-connect-payout response supports retryable balance insufficiency details', () => {
    const failed = {
      success: false,
      error: 'Connected account available balance is insufficient for this payout.',
      code: 'stripe_balance_insufficient',
      retryable: true,
      required_amount_cents: 10_000,
      available_amount_cents: 7_500,
      currency: 'mxn',
    } satisfies ReleaseConnectPayoutResponse;

    expect(failed).toMatchObject({
      code: 'stripe_balance_insufficient',
      retryable: true,
      required_amount_cents: 10_000,
      available_amount_cents: 7_500,
      currency: 'mxn',
    });
  });

  test('queue contract exposes release amount, ineligible reason, and Connect transfer fields from generated view', () => {
    // The Phase 1 migration added `shipments.stripe_transfer_id` and surfaced
    // both `stripe_transfer_id` and the order-level `transfer_group` on
    // `admin_connect_payout_release_view`. The release step must see them to
    // build/reuse per-shipment Transfers keyed by transfer_group (Phase 5).
    const row = {
      shipment_id: 'shipment-1',
      seller_id: 'seller-1',
      seller_name: 'Seller One',
      order_id: 'order-1',
      status: 'completed',
      completed_at: '2026-06-21T00:00:00Z',
      stripe_payment_intent_id: 'pi_123',
      stripe_account_id: 'acct_123',
      stripe_onboarding_status: 'complete',
      release_amount_cents: 10_000,
      is_eligible: true,
      ineligible_reason: null,
      // New SCT (Stripe Connect Transfer) contract fields surfaced by the view.
      // null until the manual release step creates the per-shipment Transfer.
      stripe_transfer_id: null,
      // Order-level grouping key the release step uses to correlate Transfers
      // to the original platform buyer charge.
      transfer_group: 'selene_order_order-1',
    } satisfies ConnectPayoutReleaseQueueRow;

    expect(row.release_amount_cents).toBe(10_000);
    expect(row.ineligible_reason).toBeNull();
    expect(row.stripe_transfer_id).toBeNull();
    expect(row.transfer_group).toBe('selene_order_order-1');
  });

  test('create-dispute contract requires shipment context for multi-seller safety', () => {
    const payload = {
      orderId: 'order-1',
      shipmentId: 'shipment-1',
      reason: 'damaged',
      description: 'GPU arrived damaged',
      evidence: {
        images: ['damage.jpg'],
        tech_checklist: { powers_on: false },
        video_url: null,
      },
    } satisfies CreateDisputeRequest;

    const registryPayload: EdgeFunctionRegistry['create-dispute']['payload'] = payload;

    expect(registryPayload.shipmentId).toBe('shipment-1');
  });

  test('refresh-connect-account-status contract exposes cached refresh errors', () => {
    const payload = {
      force: false,
    } satisfies EdgeFunctionRegistry['refresh-connect-account-status']['payload'];

    const response = {
      status: 'complete',
      hasStripeAccount: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      refreshedAt: '2026-06-27T00:00:00.000Z',
      cached: true,
    } satisfies EdgeFunctionRegistry['refresh-connect-account-status']['response'];

    expect(payload.force).toBe(false);
    expect(response.status).toBe('complete');
  });
});
