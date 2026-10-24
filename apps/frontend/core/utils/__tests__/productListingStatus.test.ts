import { describe, expect, it } from 'bun:test';

import {
  ACTIVE_LISTING_STATUSES,
  BUYER_LISTED_STATUSES,
  isInVerification,
} from '../productListingStatus';

describe('product listing statuses', () => {
  it('active listings are verified or still in verification, never sold', () => {
    expect([...ACTIVE_LISTING_STATUSES]).toEqual([
      'VERIFIED',
      'PENDING_VERIFICATION',
      'IN_REVIEW',
    ]);
  });

  it('buyer lists add SOLD to the active listings', () => {
    expect([...BUYER_LISTED_STATUSES]).toEqual([
      'VERIFIED',
      'PENDING_VERIFICATION',
      'IN_REVIEW',
      'SOLD',
    ]);
  });

  it('never lists rejected, hidden, reserved or disputed listings', () => {
    for (const status of ['REJECTED', 'HIDDEN', 'RESERVED', 'IN_DISPUTE']) {
      expect(BUYER_LISTED_STATUSES as readonly string[]).not.toContain(status);
    }
  });

  it('flags only PENDING_VERIFICATION and IN_REVIEW as in verification', () => {
    expect(isInVerification('PENDING_VERIFICATION')).toBe(true);
    expect(isInVerification('IN_REVIEW')).toBe(true);
    for (const status of ['VERIFIED', 'SOLD', 'REJECTED', 'HIDDEN', 'RESERVED']) {
      expect(isInVerification(status)).toBe(false);
    }
  });
});
