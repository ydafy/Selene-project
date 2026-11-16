import { describe, expect, test } from 'bun:test';
import type {
  ConnectPayoutQueueBucket,
  ConnectPayoutQueueCounts,
  ConnectPayoutReleaseQueueResponse,
  ConnectPayoutReleaseQueueRow,
  ConnectPayoutReleaseRequest,
  RecordPayoutHoldNoteRequest,
  RecordPayoutHoldNoteResponse,
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

    const registryPayload: EdgeFunctionRegistry['release-connect-payout']['payload'] =
      payload;

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
      error:
        'Connected account available balance is insufficient for this payout.',
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
      seller_payout_block_reason: null,
      order_id: 'order-1',
      status: 'completed',
      completed_at: '2026-06-21T00:00:00Z',
      days_since_completed: null,
      is_payout_overdue: false,
      latest_hold_note: null,
      latest_hold_noted_at: null,
      latest_hold_noted_by: null,
      stripe_payment_intent_id: 'pi_123',
      stripe_account_id: 'acct_123',
      stripe_onboarding_status: 'complete',
      release_amount_cents: 10_000,
      is_eligible: true,
      ineligible_reason: null,
      is_retryable: false,
      requires_manual_review: false,
      payout_run_amount_cents: null,
      payout_run_failed_at: null,
      payout_run_failure_reason: null,
      payout_run_id: null,
      payout_run_paid_at: null,
      payout_run_status: null,
      retry_of_run_id: null,
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

  test('queue counts carry the overdue bucket next to the other four', () => {
    const counts = {
      ready: 2,
      overdue: 1,
      processing: 0,
      'action-required': 0,
      history: 3,
    } satisfies ConnectPayoutQueueCounts;
    const bucket: ConnectPayoutQueueBucket = 'overdue';
    const response = {
      success: true,
      rows: [],
      counts,
      bucket,
      scope: 'page',
      page: 0,
      pageSize: 20,
      totalGroups: 1,
      totalPages: 1,
      selectedGroupCount: 0,
      selectionComplete: false,
    } satisfies EdgeFunctionRegistry['get-connect-payout-release-queue']['response'] &
      ConnectPayoutReleaseQueueResponse;
    const request = {
      bucket: 'overdue',
      page: 0,
    } satisfies EdgeFunctionRegistry['get-connect-payout-release-queue']['payload'];

    expect(Object.keys(response.counts).sort()).toEqual([
      'action-required',
      'history',
      'overdue',
      'processing',
      'ready',
    ]);
    expect(request.bucket).toBe('overdue');
  });

  test('queue rows carry the overdue flag and the latest hold note', () => {
    const fields = {
      is_payout_overdue: true,
      latest_hold_note: 'Stripe sigue revisando la cuenta',
      latest_hold_noted_at: '2026-11-14T05:27:34.123456+00:00',
      latest_hold_noted_by: '00000000-0000-4000-8000-000000000001',
    } satisfies Pick<
      ConnectPayoutReleaseQueueRow,
      | 'is_payout_overdue'
      | 'latest_hold_note'
      | 'latest_hold_noted_at'
      | 'latest_hold_noted_by'
    >;

    expect(fields.is_payout_overdue).toBe(true);
  });

  test('record-payout-hold-note takes a shipment and a note and returns the stored note', () => {
    const payload = {
      shipment_id: '7b310000-0000-4000-8000-000000000011',
      note: 'Stripe sigue revisando la cuenta',
    } satisfies RecordPayoutHoldNoteRequest;
    const stored = {
      id: '9c000000-0000-4000-8000-000000000001',
      shipment_id: payload.shipment_id,
      note: payload.note,
      noted_at: '2026-11-14T05:27:34.123456+00:00',
      noted_by: '00000000-0000-4000-8000-000000000001',
    } satisfies RecordPayoutHoldNoteResponse;
    const failed = {
      error: 'PAYOUT_NOT_OVERDUE',
    } satisfies RecordPayoutHoldNoteResponse;

    const registryPayload: EdgeFunctionRegistry['record-payout-hold-note']['payload'] =
      payload;
    const registryResponse: EdgeFunctionRegistry['record-payout-hold-note']['response'] =
      stored;

    expect(registryPayload).toEqual(payload);
    expect(registryResponse).toEqual(stored);
    expect(failed.error).toBe('PAYOUT_NOT_OVERDUE');
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

    const registryPayload: EdgeFunctionRegistry['create-dispute']['payload'] =
      payload;

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
