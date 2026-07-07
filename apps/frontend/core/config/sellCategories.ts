import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ProductCategory } from '@selene/types';

import { SELL_FORM_CONFIG } from './sell-form-config';

/**
 * Categories enabled for the sell wizard, derived from the form config.
 * Deriving the list keeps the picker in sync with the spec/schema.
 */
export const SELL_CATEGORIES: ProductCategory[] = Object.keys(
  SELL_FORM_CONFIG,
) as ProductCategory[];

/**
 * Static UI metadata for each sell category.
 * The category *list* is derived from config; icons are presentation-only.
 */
export const SELL_CATEGORY_META = {
  GPU: { labelKey: 'sell:categories.gpu', icon: 'expansion-card-variant' },
  CPU: { labelKey: 'sell:categories.cpu', icon: 'cpu-64-bit' },
  Motherboard: {
    labelKey: 'sell:categories.motherboard',
    icon: 'developer-board',
  },
  RAM: { labelKey: 'sell:categories.ram', icon: 'memory' },
} as const satisfies Record<
  ProductCategory,
  { labelKey: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }
>;

/**
 * Returns the i18n label key for a sell category.
 */
export const getSellCategoryLabelKey = (category: ProductCategory): string =>
  SELL_CATEGORY_META[category]?.labelKey ?? `sell:categories.${category.toLowerCase()}`;
