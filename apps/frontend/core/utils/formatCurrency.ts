/**
 * Pure, locale-aware currency formatter.
 *
 * Kept separate from `format.ts` so it can be unit-tested in Bun without
 * pulling in the React Native i18n runtime.
 */

export const formatCurrencyWithLocale = (
  amount: number | string | null | undefined,
  locale: string,
): string => {
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (value === null || value === undefined || isNaN(value)) return '$0.00';

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};
