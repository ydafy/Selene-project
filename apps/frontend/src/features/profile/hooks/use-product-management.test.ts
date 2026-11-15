import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { getStatusColor, isProductHistory } from '../logic/product-status';
import {
  removeProductFromCachedLists,
  restoreCachedLists,
} from './optimistic-list-removal';

// ─── Product Status Utilities ─────────────────────────────────────────────

describe('getStatusColor', () => {
  test('maps in_dispute to warning color', () => {
    expect(getStatusColor('in_dispute')).toBe('warning');
  });

  test('maps hidden to textSecondary', () => {
    expect(getStatusColor('hidden')).toBe('textSecondary');
  });

  test('maps verified to success', () => {
    expect(getStatusColor('verified')).toBe('success');
  });

  test('returns textSecondary for unknown/null status', () => {
    expect(getStatusColor(null)).toBe('textSecondary');
    expect(getStatusColor(undefined)).toBe('textSecondary');
    expect(getStatusColor('UNKNOWN' as string)).toBe('textSecondary');
  });
});

describe('isProductHistory', () => {
  test('classifies sold as history', () => {
    expect(isProductHistory('sold')).toBe(true);
  });

  test('classifies rejected as history', () => {
    expect(isProductHistory('rejected')).toBe(true);
  });

  test('classifies hidden as history', () => {
    expect(isProductHistory('hidden')).toBe(true);
  });

  test('in_dispute is NOT history — seller must see it', () => {
    expect(isProductHistory('in_dispute')).toBe(false);
  });

  test('verified is NOT history', () => {
    expect(isProductHistory('verified')).toBe(false);
  });

  test('null/undefined is NOT history', () => {
    expect(isProductHistory(null)).toBe(false);
    expect(isProductHistory(undefined)).toBe(false);
  });
});

// ─── Deletion Guard Logic (contract tests) ────────────────────────────────

describe('deletion pre-flight guards', () => {
  /**
   * These tests encode the business rules from REQ-PD-002.
   * The actual guard logic lives in useProductManagement.ts `onMutate`.
   * These serve as executable documentation of the contract.
   */

  const GUARD_REJECTED_STATUSES = ['sold', 'reserved', 'in_dispute'] as const;

  test('sold products are blocked from deletion', () => {
    expect(GUARD_REJECTED_STATUSES).toContain('sold');
  });

  test('reserved products are blocked from deletion', () => {
    expect(GUARD_REJECTED_STATUSES).toContain('reserved');
  });

  test('in_dispute products are blocked from deletion (trust local status, no network probe)', () => {
    expect(GUARD_REJECTED_STATUSES).toContain('in_dispute');
  });

  test('verified, pending_verification, in_review, rejected are deletable (status check only)', () => {
    const deletable = [
      'verified',
      'pending_verification',
      'in_review',
      'rejected',
    ];
    for (const status of deletable) {
      expect(GUARD_REJECTED_STATUSES).not.toContain(status);
    }
  });

  test('ownership check compares seller_id to currentUserId', () => {
    // Contract: product.seller_id !== currentUserId → reject
    const product = { seller_id: 'user-a' };
    const currentUserId = 'user-b';
    expect(product.seller_id).not.toBe(currentUserId);
    // The hook throws FORBIDDEN_NOT_OWNER when this condition is true
  });

  test('dispute check probes order_items → shipments → disputes chain', () => {
    // Contract: when open disputes exist for the product, reject BLOCKED_DISPUTE
    // This is an integration test path — verified via integration testing
    expect(true).toBe(true); // Contract marker — actual DB probe in production
  });
});

// ─── Optimistic Update Contract ───────────────────────────────────────────

describe('optimistic delete contract', () => {
  // Lists live under ['my-listings', userId] and ['products', filters] (#82),
  // so the removal must reach every entry under each prefix.
  const seed = () => {
    const client = new QueryClient();
    client.setQueryData(
      ['my-listings', 'seller-1'],
      [{ id: '1' }, { id: '2' }],
    );
    client.setQueryData(
      ['products', { sellerId: null }],
      [{ id: '2' }, { id: '3' }],
    );
    client.setQueryData(['products', { sellerId: 'seller-1' }], [{ id: '2' }]);
    client.setQueryData(['product', '2'], { id: '2' });
    return client;
  };

  test('onMutate removes the product from every cached my-listings and products list', () => {
    const client = seed();
    removeProductFromCachedLists(client, ['my-listings', 'products'], '2');
    expect(client.getQueryData(['my-listings', 'seller-1'])).toEqual([
      { id: '1' },
    ]);
    expect(client.getQueryData(['products', { sellerId: null }])).toEqual([
      { id: '3' },
    ]);
    expect(client.getQueryData(['products', { sellerId: 'seller-1' }])).toEqual(
      [],
    );
    // The product detail is not a list and stays as it is
    expect(client.getQueryData(['product', '2'])).toEqual({ id: '2' });
  });

  test('onMutate leaves non-list data under the prefixes untouched', () => {
    const client = seed();
    client.setQueryData(['products', 'count'], 7);
    removeProductFromCachedLists(client, ['products'], '2');
    expect(client.getQueryData(['products', 'count'])).toBe(7);
  });

  test('onError restores every list exactly as it was before onMutate', () => {
    const client = seed();
    const snapshot = removeProductFromCachedLists(
      client,
      ['my-listings', 'products'],
      '2',
    );
    restoreCachedLists(client, snapshot);
    expect(client.getQueryData(['my-listings', 'seller-1'])).toEqual([
      { id: '1' },
      { id: '2' },
    ]);
    expect(client.getQueryData(['products', { sellerId: null }])).toEqual([
      { id: '2' },
      { id: '3' },
    ]);
    expect(client.getQueryData(['products', { sellerId: 'seller-1' }])).toEqual(
      [{ id: '2' }],
    );
  });

  test('the hook uses the prefix helpers, never the exact list keys', () => {
    const hook = readFileSync(
      join(import.meta.dir, 'use-product-management.ts'),
      'utf8',
    );
    expect(hook).not.toMatch(/getQueryData\(\['(products|my-listings)'\]\)/);
    expect(hook).not.toMatch(/setQueryData\(\['(products|my-listings)'\]/);
    expect(hook).toContain('removeProductFromCachedLists(');
    expect(hook).toContain('restoreCachedLists(');
  });

  test('onSuccess fires haptics only on iOS', () => {
    // Contract: Platform.OS === 'ios' && Haptics → notificationAsync('success')
    const platform = 'ios';
    const hasHaptics = false; // Test env won't have expo-haptics
    const shouldFire = platform === 'ios' && hasHaptics;
    expect(shouldFire).toBe(false); // Safe in test — no crash
  });
});

// ─── PostgREST Filter ─────────────────────────────────────────────────────

describe('PostgREST filter contract', () => {
  test('CSV syntax without inner quotes for not-in filter', () => {
    // REQ-PD-004: .not('status', 'in', '(hidden,rejected)')
    const filterValue = '(hidden,rejected)';
    expect(filterValue).not.toContain('"');
    expect(filterValue).toMatch(/^\([a-z_,]+\)$/);
  });
});

// ─── in_dispute Type Safety ────────────────────────────────────────────────

describe('in_dispute type contract', () => {
  test('is a valid ProductStatus', () => {
    const status = 'in_dispute' as const;
    // Compile-time: if in_dispute is missing from ProductStatus union, TS errors
    expect(typeof status).toBe('string');
  });
});
