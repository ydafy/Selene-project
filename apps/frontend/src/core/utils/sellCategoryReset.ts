/**
 * Fields that must be reset when the product category changes.
 * Keeping this list centralized ensures specs/condition/usage stay in sync.
 */
export const CATEGORY_DEPENDENT_FIELDS = [
  'condition',
  'usage',
  'specifications',
] as const;

/**
 * Returns the default values for fields that depend on the selected category.
 */
export const getCategoryResetFields = (): {
  condition: string;
  usage: string;
  specifications: Record<string, never>;
} => ({
  condition: '',
  usage: '',
  specifications: {},
});
