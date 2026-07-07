export interface UseProductsOptions {
  verifiedOnly?: boolean;
  limit?: number;
  sellerId?: string;
  enabled?: boolean;
}

export const resolveProductsQueryEnabled = (options?: UseProductsOptions) =>
  options?.enabled ?? true;
