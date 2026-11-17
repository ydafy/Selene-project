import type { Tables } from '@selene/types';

type SystemSettings = Pick<
  Tables<'system_settings'>,
  'service_fee_pct' | 'shipping_buffer_cents' | 'insurance_rate'
>;

/** Settings as read by the app; any of them may be missing until loaded. */
type SellerProceedsSettings = {
  [K in keyof SystemSettings]?: SystemSettings[K] | null;
};

export interface SellerProceedsEstimateInput {
  priceCents: number;
  quoteCents: number;
  settings: SellerProceedsSettings | null | undefined;
}

export interface SellerProceedsEstimate {
  commissionCents: number;
  shippingCents: number;
  insuranceCents: number;
  finalCents: number;
}

// Rates are fractions in 0..1 (system_settings CHECK); there is no default.
const isRate = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Estimates what the seller receives from the configured rates. Returns null
 * when any setting is missing or invalid, so the caller shows no amount
 * instead of one computed from a default that can disagree with the server.
 */
export const calculateSellerProceedsEstimate = ({
  priceCents,
  quoteCents,
  settings,
}: SellerProceedsEstimateInput): SellerProceedsEstimate | null => {
  const serviceFeePct = settings?.service_fee_pct;
  const shippingBufferCents = settings?.shipping_buffer_cents;
  const insuranceRate = settings?.insurance_rate;
  if (
    !isRate(serviceFeePct) ||
    !isRate(insuranceRate) ||
    !isCents(shippingBufferCents)
  ) {
    return null;
  }

  const safePriceCents = Math.max(0, Math.round(priceCents));
  const safeQuoteCents = Math.max(0, Math.round(quoteCents));
  const commissionCents = Math.round(safePriceCents * serviceFeePct);
  const shippingCents =
    safeQuoteCents > 0 ? safeQuoteCents + shippingBufferCents : 0;
  // Rounded up, like the reserve the server freezes at publication.
  const insuranceCents = Math.ceil(safePriceCents * insuranceRate);
  const rawFinalCents =
    safePriceCents - commissionCents - shippingCents - insuranceCents;

  return {
    commissionCents,
    shippingCents,
    insuranceCents,
    finalCents: Math.max(0, rawFinalCents),
  };
};

/** Configured service fee as a display percent (0.06 -> 6), or null when unknown. */
export const resolveCommissionPercent = (
  value: number | null | undefined,
): number | null => {
  if (value === null || value === undefined) return null;
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) return null;
  return Math.round(rate * 1000) / 10;
};

const formatCentsAsMx = (valueCents: number): string =>
  (Math.max(0, Math.round(valueCents)) / 100).toFixed(2);

interface SellerEarnings {
  commission: string | null;
  shipping: string | null;
  final: string | null;
  commissionPct: number | null;
}

/** What the sell form shows; null amounts mean "no amount yet". */
export const buildSellerEarnings = (
  input: SellerProceedsEstimateInput,
): SellerEarnings => {
  const commissionPct = resolveCommissionPercent(
    input.settings?.service_fee_pct,
  );
  const estimate =
    input.priceCents > 0 ? calculateSellerProceedsEstimate(input) : null;
  if (!estimate) {
    return { commission: null, shipping: null, final: null, commissionPct };
  }

  return {
    commission: formatCentsAsMx(estimate.commissionCents),
    shipping: formatCentsAsMx(estimate.shippingCents),
    final: formatCentsAsMx(estimate.finalCents),
    commissionPct,
  };
};
