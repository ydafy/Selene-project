// Postgres unique violation, raised when the buyer already reviewed this
// shipment and product.
const UNIQUE_VIOLATION = '23505';

/**
 * Maps a failed review insert to user-facing copy. The raw database error
 * never reaches the user; callers keep it in their logs (#319).
 */
export const reviewErrorMessage = (
  error: unknown,
  t: (key: string) => string,
): string => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  return code === UNIQUE_VIOLATION
    ? t('orders:errors.alreadyReviewed')
    : t('common:errors.generic');
};
