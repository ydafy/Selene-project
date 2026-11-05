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
