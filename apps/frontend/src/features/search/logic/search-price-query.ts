import type { PublicProduct } from '@selene/types';
import { pesosToCents } from '@/shared/utils/money/pesos-to-cents';

type SearchOrderBy = 'newest' | 'price_asc' | 'price_desc';
type SortColumn = Extract<keyof PublicProduct, 'price_cents' | 'created_at'>;

/**
 * The price slider works in whole pesos; the `price_cents` column holds
 * integer cents. Converts the slider range at the query boundary.
 */
export const priceRangeFilterCents = ([minPesos, maxPesos]: [number, number]): {
  column: 'price_cents';
  minCents: number;
  maxCents: number;
} => ({
  column: 'price_cents',
  minCents: pesosToCents(minPesos),
  maxCents: pesosToCents(maxPesos),
});

const SORT_ORDERS: Record<
  SearchOrderBy,
  { column: SortColumn; ascending: boolean }
> = {
  price_asc: { column: 'price_cents', ascending: true },
  price_desc: { column: 'price_cents', ascending: false },
  newest: { column: 'created_at', ascending: false },
};

export const searchSortOrder = (
  orderBy: SearchOrderBy | undefined,
): { column: SortColumn; ascending: boolean } =>
  SORT_ORDERS[orderBy ?? 'newest'];
