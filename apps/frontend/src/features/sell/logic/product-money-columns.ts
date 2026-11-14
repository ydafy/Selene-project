import type { Product } from '@selene/types';
import { pesosToCents } from '@/shared/utils/money/pesos-to-cents';

import type { SellDraft } from '../store/use-sell-store';

/**
 * The money columns of a product write. The sell form edits pesos strings;
 * the `products` table stores integer cents. An empty shipping quote is 0.
 */
export const productMoneyColumns = (
  draft: Pick<SellDraft, 'price' | 'shipping_cost'>,
): Pick<Product, 'price_cents' | 'shipping_cost_cents'> => ({
  price_cents: pesosToCents(draft.price),
  shipping_cost_cents: pesosToCents(draft.shipping_cost || '0'),
});
