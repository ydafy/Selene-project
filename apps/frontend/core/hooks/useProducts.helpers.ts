import type { ProductStatus } from '@selene/types';

export interface UseProductsOptions {
  verifiedOnly?: boolean;
  limit?: number;
  sellerId?: string;
  enabled?: boolean;
  /** Statuses the list shows; defaults to VERIFIED and SOLD. */
  statuses?: readonly ProductStatus[];
}

const DEFAULT_STATUSES: readonly ProductStatus[] = ['VERIFIED', 'SOLD'];

export const resolveProductsQueryEnabled = (options?: UseProductsOptions) =>
  options?.enabled ?? true;

export const resolveProductStatuses = (
  options?: UseProductsOptions,
): readonly ProductStatus[] => options?.statuses ?? DEFAULT_STATUSES;
