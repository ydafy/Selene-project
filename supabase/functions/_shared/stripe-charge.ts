type StripeChargeReference = string | { id?: unknown } | null | undefined;

export type PaymentIntentChargeSource = {
  latest_charge?: StripeChargeReference;
  charges?: { data?: Array<{ id?: unknown }> } | null;
};

export function extractStripeChargeId(
  intent: PaymentIntentChargeSource,
): string | null {
  const latestCharge = intent.latest_charge;
  if (typeof latestCharge === 'string' && latestCharge.length > 0) {
    return latestCharge;
  }

  if (
    latestCharge &&
    typeof latestCharge === 'object' &&
    typeof latestCharge.id === 'string' &&
    latestCharge.id.length > 0
  ) {
    return latestCharge.id;
  }

  const firstCharge = intent.charges?.data?.[0];
  if (firstCharge && typeof firstCharge.id === 'string' && firstCharge.id.length > 0) {
    return firstCharge.id;
  }

  return null;
}
