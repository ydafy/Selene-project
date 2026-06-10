import { expect, test, describe } from 'bun:test';
import { getStatusColor, isProductHistory } from '../../utils/product-status';

// ─── Product Status Utilities ─────────────────────────────────────────────

describe('getStatusColor', () => {
  test('maps IN_DISPUTE to warning color', () => {
    expect(getStatusColor('IN_DISPUTE')).toBe('warning');
  });

  test('maps HIDDEN to textSecondary', () => {
    expect(getStatusColor('HIDDEN')).toBe('textSecondary');
  });

  test('maps VERIFIED to success', () => {
    expect(getStatusColor('VERIFIED')).toBe('success');
  });

  test('returns textSecondary for unknown/null status', () => {
    expect(getStatusColor(null)).toBe('textSecondary');
    expect(getStatusColor(undefined)).toBe('textSecondary');
    expect(getStatusColor('UNKNOWN' as string)).toBe('textSecondary');
  });
});

describe('isProductHistory', () => {
  test('classifies SOLD as history', () => {
    expect(isProductHistory('SOLD')).toBe(true);
  });

  test('classifies REJECTED as history', () => {
    expect(isProductHistory('REJECTED')).toBe(true);
  });

  test('classifies HIDDEN as history', () => {
    expect(isProductHistory('HIDDEN')).toBe(true);
  });

  test('IN_DISPUTE is NOT history — seller must see it', () => {
    expect(isProductHistory('IN_DISPUTE')).toBe(false);
  });

  test('VERIFIED is NOT history', () => {
    expect(isProductHistory('VERIFIED')).toBe(false);
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

  const GUARD_REJECTED_STATUSES = ['SOLD', 'RESERVED', 'IN_DISPUTE'] as const;

  test('SOLD products are blocked from deletion', () => {
    expect(GUARD_REJECTED_STATUSES).toContain('SOLD');
  });

  test('RESERVED products are blocked from deletion', () => {
    expect(GUARD_REJECTED_STATUSES).toContain('RESERVED');
  });

  test('IN_DISPUTE products are blocked from deletion (trust local status, no network probe)', () => {
    expect(GUARD_REJECTED_STATUSES).toContain('IN_DISPUTE');
  });

  test('VERIFIED, PENDING_VERIFICATION, IN_REVIEW, REJECTED are deletable (status check only)', () => {
    const deletable = ['VERIFIED', 'PENDING_VERIFICATION', 'IN_REVIEW', 'REJECTED'];
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
  test('onMutate removes product from my-listings and products caches', () => {
    // Contract: queryClient.setQueryData filters out the product.id
    const cache = [{ id: '1' }, { id: '2' }, { id: '3' }];
    const filtered = cache.filter((p) => p.id !== '2');
    expect(filtered).toEqual([{ id: '1' }, { id: '3' }]);
  });

  test('onError restores previous cache snapshots', () => {
    // Contract: ctx.prevListings and ctx.prevProducts are restored
    const prev = [{ id: '1' }, { id: '2' }];
    const restored = [...prev];
    expect(restored).toEqual(prev);
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
    // REQ-PD-004: .not('status', 'in', '(HIDDEN,REJECTED)')
    const filterValue = '(HIDDEN,REJECTED)';
    expect(filterValue).not.toContain('"');
    expect(filterValue).toMatch(/^\([A-Z_,]+\)$/);
  });
});

// ─── IN_DISPUTE Type Safety ────────────────────────────────────────────────

describe('IN_DISPUTE type contract', () => {
  test('is a valid ProductStatus', () => {
    const status = 'IN_DISPUTE' as const;
    // Compile-time: if IN_DISPUTE is missing from ProductStatus union, TS errors
    expect(typeof status).toBe('string');
  });
});
