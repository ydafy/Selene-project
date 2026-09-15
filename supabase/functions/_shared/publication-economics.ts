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

export type SellerShippingReserveInput = {
  priceCents: number;
  quotedShippingCents: number;
  shippingBufferCents: number;
  insuranceRate: number;
};

const isCents = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 0;

const isRate = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

/** Calculates the publication-time seller reserve from trusted quote inputs. */
export function calculateEstimatedSellerShippingDeductionCents({
  priceCents,
  quotedShippingCents,
  shippingBufferCents,
  insuranceRate,
}: SellerShippingReserveInput): number {
  if (
    !isCents(priceCents) ||
    !isCents(quotedShippingCents) ||
    !isCents(shippingBufferCents) ||
    !isRate(insuranceRate)
  ) {
    throw new Error('INVALID_PUBLICATION_ECONOMICS');
  }

  const insuranceCents = Math.ceil(priceCents * insuranceRate);
  const reserveCents = quotedShippingCents + shippingBufferCents + insuranceCents;
  if (!Number.isSafeInteger(reserveCents)) {
    throw new Error('INVALID_PUBLICATION_ECONOMICS');
  }

  return reserveCents;
}

/**
 * Returns null exclusively for an all-null legacy row. Partial snapshots fail
 * closed so callers cannot combine historical and current financial inputs.
 */
export function validatePublicationEconomicsSnapshot(
  snapshot: PublicationEconomicsSnapshot,
): PublicationEconomics | null {
  const reserve = snapshot.publication_shipping_reserve_cents;
  const commission = snapshot.publication_commission_rate;
  const insurance = snapshot.publication_insurance_rate;
  if (reserve === null && commission === null && insurance === null) {
    return null;
  }

  if (!isCents(reserve) || !isRate(commission) || !isRate(insurance)) {
    throw new Error('INVALID_PUBLICATION_ECONOMICS_SNAPSHOT');
  }

  return {
    shippingReserveCents: reserve,
    commissionRate: commission,
    insuranceRate: insurance,
  };
}

export function resolvePublicationEconomics(
  snapshot: PublicationEconomicsSnapshot,
  resolveLegacyEconomics: () => PublicationEconomics,
): PublicationEconomics {
  return validatePublicationEconomicsSnapshot(snapshot) ?? resolveLegacyEconomics();
}
