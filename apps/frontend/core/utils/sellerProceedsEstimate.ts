import type { Tables } from '@selene/types';

type SystemSettings = Pick<
  Tables<'system_settings'>,
  'service_fee_pct' | 'shipping_buffer_cents' | 'insurance_rate'
>;

export interface SellerProceedsEstimateInput {
  priceCents: number;
  quoteCents: number;
  settings: SystemSettings;
}

export interface SellerProceedsEstimate {
  commissionCents: number;
  shippingCents: number;
  insuranceCents: number;
  finalCents: number;
  normalizedInsuranceRate: number;
}

const DEFAULT_SERVICE_FEE_PCT = 0.05;
const DEFAULT_SHIPPING_BUFFER_CENTS = 5_000;

/**
 * Normalizes legacy insurance settings into a decimal rate.
 * Supports the observed fractional shape (`0.012`) and defensive admin-entry
 * shapes (`1.2` percent or `120` basis points) without changing money flows.
 */
export const normalizeInsuranceRate = (value: number | null): number => {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value <= 1) {
    return value;
  }

  if (value <= 100) {
    return value / 100;
  }

  return value / 10_000;
};

export const calculateSellerProceedsEstimate = ({
  priceCents,
  quoteCents,
  settings,
}: SellerProceedsEstimateInput): SellerProceedsEstimate => {
  const safePriceCents = Math.max(0, Math.round(priceCents));
  const safeQuoteCents = Math.max(0, Math.round(quoteCents));
  const serviceFeePct = settings.service_fee_pct ?? DEFAULT_SERVICE_FEE_PCT;
  const shippingBufferCents =
    settings.shipping_buffer_cents ?? DEFAULT_SHIPPING_BUFFER_CENTS;
  const normalizedInsuranceRate = normalizeInsuranceRate(
    settings.insurance_rate,
  );

  const commissionCents = Math.round(safePriceCents * serviceFeePct);
  const shippingCents =
    safeQuoteCents > 0 ? safeQuoteCents + shippingBufferCents : 0;
  const insuranceCents = Math.round(
    safePriceCents * normalizedInsuranceRate,
  );
  const rawFinalCents =
    safePriceCents - commissionCents - shippingCents - insuranceCents;

  return {
    commissionCents,
    shippingCents,
    insuranceCents,
    finalCents: Math.max(0, rawFinalCents),
    normalizedInsuranceRate,
  };
};

export const formatCentsAsMx = (valueCents: number): string =>
  (Math.max(0, Math.round(valueCents)) / 100).toFixed(2);
