/**
 * Pure, locale-aware MXN formatter for integer cents.
 *
 * Kept separate from `format-cents.ts` so it can be unit-tested in Bun without
 * pulling in the React Native i18n runtime.
 */

export const formatCentsWithLocale = (
  cents: number,
  locale: string,
): string => {
  if (!Number.isFinite(cents)) return '$0.00';

  // Display boundary: the only place cents become pesos.
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
};
