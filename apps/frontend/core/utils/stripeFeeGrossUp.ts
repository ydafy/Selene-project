export interface GrossUpResult {
  buyerTotalCents: number;
  seguroCents: number;
}

export function grossUpDomesticMx(subtotalCents: number): GrossUpResult {
  if (
    !Number.isFinite(subtotalCents) ||
    !Number.isInteger(subtotalCents) ||
    subtotalCents < 0
  ) {
    throw new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:subtotalCents');
  }

  const numerator = (BigInt(subtotalCents) + 348n) * 100_000n;
  const buyerTotalCents = Number((numerator + 95_824n - 1n) / 95_824n);

  if (!Number.isSafeInteger(buyerTotalCents)) {
    throw new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:buyerTotalOverflow');
  }

  return {
    buyerTotalCents,
    seguroCents: buyerTotalCents - subtotalCents,
  };
}
