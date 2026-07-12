export interface GrossUpResult {
  buyerTotalCents: number;
  seguroCents: number;
}

export interface AllocationWeight {
  id: string;
  cents: number;
}

const assertCents = (name: string, value: number) => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`INVALID_STRIPE_FEE_GROSS_UP_INPUT:${name}`);
  }
};

export function grossUpDomesticMx(subtotalCents: number): GrossUpResult {
  assertCents('subtotalCents', subtotalCents);

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

export function allocateCents(
  totalCents: number,
  weights: AllocationWeight[],
): Map<string, number> {
  assertCents('totalCents', totalCents);

  if (!Array.isArray(weights) || weights.length === 0) {
    throw new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:empty_weights');
  }

  const normalized = weights.map((weight) => {
    if (!weight || typeof weight.id !== 'string' || weight.id.length === 0) {
      throw new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:missing_id');
    }
    assertCents(`weight:${weight.id}`, weight.cents);
    return weight;
  });

  const totalWeight = normalized.reduce((sum, weight) => sum + weight.cents, 0);
  if (totalWeight === 0) {
    if (totalCents !== 0) {
      throw new Error('INVALID_STRIPE_FEE_GROSS_UP_INPUT:zero_weight_total');
    }
    return new Map(normalized.map((weight) => [weight.id, 0]));
  }

  const allocations = normalized.map((weight) => {
    const exact = (totalCents * weight.cents) / totalWeight;
    const base = Math.floor(exact);
    return {
      id: weight.id,
      cents: weight.cents,
      amount: base,
      remainder: exact - base,
    };
  });

  const assigned = allocations.reduce((sum, entry) => sum + entry.amount, 0);
  let remaining = totalCents - assigned;

  const ranked = [...allocations].sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  for (const entry of ranked) {
    if (remaining <= 0) break;
    entry.amount += 1;
    remaining -= 1;
  }

  return new Map(allocations.map((entry) => [entry.id, entry.amount]));
}
