import type { ProductStatus } from '@selene/types';

/**
 * Listing statuses buyers can find (L31). RLS decides who may read a row;
 * these lists decide what each screen shows. Only VERIFIED is purchasable
 * (fn_reserve_products), so listings in verification carry a badge.
 */
export const IN_VERIFICATION_STATUSES = [
  'PENDING_VERIFICATION',
  'IN_REVIEW',
] as const satisfies readonly ProductStatus[];

/** Unsold listings: verified or still in verification. */
export const ACTIVE_LISTING_STATUSES = [
  'VERIFIED',
  ...IN_VERIFICATION_STATUSES,
] as const satisfies readonly ProductStatus[];

/** Every status a buyer list may show, sold listings included. */
export const BUYER_LISTED_STATUSES = [
  ...ACTIVE_LISTING_STATUSES,
  'SOLD',
] as const satisfies readonly ProductStatus[];

export const isInVerification = (status: string): boolean =>
  (IN_VERIFICATION_STATUSES as readonly string[]).includes(status);
