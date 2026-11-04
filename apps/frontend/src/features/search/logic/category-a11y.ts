/**
 * Pure helper for CategoryCard accessibility props.
 *
 * Isolated in this file so the a11y contract can be unit-tested in Bun
 * without importing React Native through the component tree.
 */

export const buildCategoryCardA11yProps = (label: string) => ({
  accessibilityRole: 'button' as const,
  accessibilityLabel: label,
});
