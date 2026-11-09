import type { ReleaseConnectPayoutResponse } from '@selene/types';

const formatMxnCents = (amountCents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'code',
  })
    .format(amountCents / 100)
    .replace(/\s+/g, ' ');

export function formatConnectPayoutReleaseError(
  response: Extract<ReleaseConnectPayoutResponse, { success: false }>,
) {
  if (response.code !== 'stripe_balance_insufficient') {
    return response.error;
  }

  const required = response.required_amount_cents;
  const available = response.available_amount_cents;
  const amounts =
    typeof required === 'number' && typeof available === 'number'
      ? ` Required: ${formatMxnCents(required)}. Available: ${formatMxnCents(available)}.`
      : '';

  return `Funds pending/not yet available in Stripe. Retry when available.${amounts}`;
}
