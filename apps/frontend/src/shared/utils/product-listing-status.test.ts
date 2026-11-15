import { describe, expect, it } from 'bun:test';

import {
  ACTIVE_LISTING_STATUSES,
  BUYER_LISTED_STATUSES,
  isInVerification,
} from './product-listing-status';

describe('product listing statuses', () => {
  it('active listings are verified or still in verification, never sold', () => {
    expect([...ACTIVE_LISTING_STATUSES]).toEqual([
      'verified',
      'pending_verification',
      'in_review',
    ]);
  });

  it('buyer lists add sold to the active listings', () => {
    expect([...BUYER_LISTED_STATUSES]).toEqual([
      'verified',
      'pending_verification',
      'in_review',
      'sold',
    ]);
  });

  it('never lists rejected, hidden, reserved or disputed listings', () => {
    for (const status of ['rejected', 'hidden', 'reserved', 'in_dispute']) {
      expect(BUYER_LISTED_STATUSES as readonly string[]).not.toContain(status);
    }
  });

  it('flags only pending_verification and in_review as in verification', () => {
    expect(isInVerification('pending_verification')).toBe(true);
    expect(isInVerification('in_review')).toBe(true);
    for (const status of [
      'verified',
      'sold',
      'rejected',
      'hidden',
      'reserved',
    ]) {
      expect(isInVerification(status)).toBe(false);
    }
  });
});
