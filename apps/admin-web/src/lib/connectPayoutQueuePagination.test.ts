import { describe, expect, test } from 'bun:test';
import type { ConnectPayoutReleaseQueueRow } from '@selene/types';
import { validatePayoutQueueResponse } from './connectPayoutQueuePagination';

const row = (id: number): ConnectPayoutReleaseQueueRow => ({
  completed_at: null, ineligible_reason: null, is_eligible: true,
  is_retryable: false, order_id: `order-${id}`, payout_run_amount_cents: null,
  payout_run_failed_at: null, payout_run_failure_reason: null,
  payout_run_id: null, payout_run_paid_at: null, payout_run_status: null,
  release_amount_cents: 100, requires_manual_review: false,
  retry_of_run_id: null, seller_id: `seller-${id}`, seller_name: `Seller ${id}`,
  shipment_id: `shipment-${id}`, status: 'completed', stripe_account_id: 'acct',
  stripe_onboarding_status: null, stripe_payment_intent_id: null,
  stripe_transfer_id: null, transfer_group: null,
});
const request = { bucket: 'ready', page: 0, scope: 'page' } as const;
const response = () => ({
  success: true, rows: Array.from({ length: 20 }, (_, i) => row(i)),
  counts: { ready: 21, processing: 0, 'action-required': 0, history: 0 },
  bucket: 'ready', scope: 'page', page: 0, pageSize: 20,
  totalGroups: 21, totalPages: 2, selectedGroupCount: 0,
  selectionComplete: false,
});

describe('payout queue wire validation', () => {
  test('preserves every shipment of twenty page groups and backend counts', () => {
    const input = response();
    input.rows.push({ ...row(0), shipment_id: 'second-shipment' });
    const result = validatePayoutQueueResponse(input, request);
    expect(result.rows).toHaveLength(21);
    expect(result.counts.ready).toBe(21);
    expect(result.totalPages).toBe(2);
  });
  test('accepts a clamped final page without slicing its complete group', () => {
    const input = { ...response(), page: 1, rows: [row(20)] };
    expect(validatePayoutQueueResponse(input, { ...request, page: 99 }).page).toBe(1);
  });
  test('accepts complete selection beyond unloaded pages, including blocked detail rows', () => {
    const input = { ...response(), scope: 'selection', selectionComplete: true,
      selectedGroupCount: 21, rows: Array.from({ length: 21 }, (_, i) => row(i)) };
    input.rows.push({ ...row(0), shipment_id: 'blocked', is_eligible: false });
    expect(validatePayoutQueueResponse(input, { ...request, scope: 'selection' }).rows).toHaveLength(22);
  });
  test('accepts empty queues with one empty page', () => {
    const input = { ...response(), rows: [], totalGroups: 0, totalPages: 1,
      counts: { ...response().counts, ready: 0 } };
    expect(validatePayoutQueueResponse(input, request).rows).toEqual([]);
  });
  for (const [name, patch] of [
    ['legacy', { counts: undefined }], ['missing rows', { rows: undefined }],
    ['wrong bucket', { bucket: 'history' }], ['wrong scope', { scope: 'selection' }],
    ['wrong page', { page: 1 }], ['wrong size', { pageSize: 19 }],
    ['wrong total pages', { totalPages: 1 }], ['wrong count', { totalGroups: 22 }],
    ['fractional count', { counts: { ...response().counts, history: 0.5 } }],
    ['truncated', { rows: [row(0)] }], ['unrequested selection', { selectionComplete: true }],
    ['failed', { success: false, error: 'FAILED' }],
  ] as const) {
    test(`rejects ${name} without changing the input`, () => {
      const input = { ...response(), ...patch };
      const before = JSON.stringify(input);
      expect(() => validatePayoutQueueResponse(input, request)).toThrow();
      expect(JSON.stringify(input)).toBe(before);
    });
  }
  test('rejects wrong-bucket rows and duplicate shipments', () => {
    const input = response();
    input.rows[0] = { ...row(0), payout_run_id: 'run', payout_run_status: 'paid' };
    expect(() => validatePayoutQueueResponse(input, request)).toThrow();
    input.rows = [...response().rows, row(0)];
    expect(() => validatePayoutQueueResponse(input, request)).toThrow();
  });
  test('rejects incomplete selection and inconsistent selected-group counts', () => {
    const input = { ...response(), scope: 'selection', selectedGroupCount: 20,
      selectionComplete: false };
    const selection = { ...request, scope: 'selection' } as const;
    expect(() => validatePayoutQueueResponse(input, selection)).toThrow();
    expect(() => validatePayoutQueueResponse({ ...input, selectionComplete: true,
      selectedGroupCount: 21 }, selection)).toThrow();
    expect(() => validatePayoutQueueResponse({ ...input, selectionComplete: true,
      rows: input.rows.map((r) => ({ ...r, is_eligible: false })) }, selection)).toThrow();
  });
  test('accepts retryable Attention groups but rejects contradictory retry detail', () => {
    const rows = [0, 1].map((i) => ({ ...row(i), payout_run_id: 'run',
      payout_run_status: 'failed', is_retryable: true, seller_id: 'seller' }));
    const input = { ...response(), bucket: 'action-required', scope: 'selection',
      rows, totalGroups: 1, totalPages: 1, selectedGroupCount: 1,
      selectionComplete: true, counts: { ready: 0, processing: 0, 'action-required': 1, history: 0 } };
    const selection = { bucket: 'action-required', scope: 'selection', page: 0 } as const;
    expect(validatePayoutQueueResponse(input, selection).rows).toHaveLength(2);
    rows[1].is_retryable = false;
    expect(() => validatePayoutQueueResponse(input, selection)).toThrow();
  });
});
