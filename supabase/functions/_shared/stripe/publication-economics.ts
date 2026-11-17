export type PublicationEconomics = {
  shippingReserveCents: number;
  commissionRate: number;
  insuranceRate: number;
};

export type PublicationEconomicsSnapshot = {
  publication_shipping_reserve_cents: unknown;
  publication_commission_rate: unknown;
  publication_insurance_rate: unknown;
};

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isRate = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

/**
 * Parses the economics frozen into a product at publication. Every field is
 * required and rates are fractions in 0..1; a missing, partial, or invalid
 * snapshot fails closed so checkout never prices a product from current
 * settings or code defaults.
 */
export function validatePublicationEconomicsSnapshot(
  snapshot: PublicationEconomicsSnapshot,
): PublicationEconomics {
  const reserve = snapshot.publication_shipping_reserve_cents;
  const commission = snapshot.publication_commission_rate;
  const insurance = snapshot.publication_insurance_rate;
  if (!isCents(reserve) || !isRate(commission) || !isRate(insurance)) {
    throw new Error('INVALID_PUBLICATION_ECONOMICS_SNAPSHOT');
  }

  return {
    shippingReserveCents: reserve,
    commissionRate: commission,
    insuranceRate: insurance,
  };
}
