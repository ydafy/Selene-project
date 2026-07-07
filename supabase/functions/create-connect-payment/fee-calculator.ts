export const CONNECT_COMMISSION_RATE = 0.06;
export const SEGURO_SELENE_RATE = 0.036;
export const SEGURO_SELENE_FIXED_CENTS = 300;
export const ENVIA_INSURANCE_RATE = 0.012;
export const DEFAULT_SHIPPING_BUFFER_CENTS = 3_000;

export interface EstimatedSellerShippingDeductionInput {
  priceCents: number;
  quotedShippingCents: number;
  shippingBufferCents?: number | null;
  insuranceRate?: number | null;
}

export interface ConnectMoneyFlowInput {
  subtotalCents: number;
  shippingCents: number;
  commissionRate?: number;
  seguroRate?: number;
  seguroFixedCents?: number;
}

export interface ConnectMoneyFlow {
  subtotalCents: number;
  commissionCents: number;
  shippingCents: number;
  seguroCents: number;
  buyerChargeCents: number;
  applicationFeeCents: number;
  sellerNetCents: number;
}

const assertCents = (name: string, value: number) => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`INVALID_MONEY_FLOW_INPUT:${name}`);
  }
};

/**
 * Validate that a shipment correlation id is present (non-empty string) and
 * unique within `seen`. Each allocation row MUST resolve to exactly one
 * shipment so manual release can address net amount to a single shipment
 * instead of inferring correlation from the seller id.
 *
 * `prefix` scopes the error code to the calling layer (allocation build vs
 * reconciliation validation).
 */
const assertUniqueShipmentId = (
  shipmentId: unknown,
  seen: Set<string>,
  prefix: 'INVALID_CHECKOUT_INPUT' | 'INVALID_ALLOCATION_RECONCILIATION',
): void => {
  if (typeof shipmentId !== 'string' || shipmentId.length === 0) {
    throw new Error(`${prefix}:missing_shipment_id`);
  }
  if (seen.has(shipmentId)) {
    throw new Error(`${prefix}:duplicate_shipment_id`);
  }
  seen.add(shipmentId);
};

export function calculateSeguroSeleneCents(
  subtotalCents: number,
  rate = SEGURO_SELENE_RATE,
  fixedCents = SEGURO_SELENE_FIXED_CENTS,
): number {
  assertCents('subtotalCents', subtotalCents);
  assertCents('fixedCents', fixedCents);

  if (!Number.isFinite(rate) || rate < 0) {
    throw new Error('INVALID_MONEY_FLOW_INPUT:seguroRate');
  }

  return Math.ceil(subtotalCents * rate) + fixedCents;
}

export function normalizeEnviaInsuranceRate(value: number | null): number {
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
}

export function calculateEstimatedSellerShippingDeductionCents({
  priceCents,
  quotedShippingCents,
  shippingBufferCents = DEFAULT_SHIPPING_BUFFER_CENTS,
  insuranceRate = ENVIA_INSURANCE_RATE,
}: EstimatedSellerShippingDeductionInput): number {
  assertCents('priceCents', priceCents);
  assertCents('quotedShippingCents', quotedShippingCents);

  const safeBufferCents =
    shippingBufferCents ?? DEFAULT_SHIPPING_BUFFER_CENTS;
  assertCents('shippingBufferCents', safeBufferCents);

  if (quotedShippingCents === 0) {
    return 0;
  }

  const insuranceCents = Math.round(
    priceCents * normalizeEnviaInsuranceRate(insuranceRate),
  );

  return quotedShippingCents + safeBufferCents + insuranceCents;
}

export function calculateConnectMoneyFlow({
  subtotalCents,
  shippingCents,
  commissionRate = CONNECT_COMMISSION_RATE,
  seguroRate = SEGURO_SELENE_RATE,
  seguroFixedCents = SEGURO_SELENE_FIXED_CENTS,
}: ConnectMoneyFlowInput): ConnectMoneyFlow {
  assertCents('subtotalCents', subtotalCents);
  assertCents('shippingCents', shippingCents);

  if (!Number.isFinite(commissionRate) || commissionRate < 0) {
    throw new Error('INVALID_MONEY_FLOW_INPUT:commissionRate');
  }

  const commissionCents = Math.round(subtotalCents * commissionRate);
  const seguroCents = calculateSeguroSeleneCents(
    subtotalCents,
    seguroRate,
    seguroFixedCents,
  );
  const buyerChargeCents = subtotalCents + seguroCents;
  const applicationFeeCents = commissionCents + shippingCents + seguroCents;
  const sellerNetCents = buyerChargeCents - applicationFeeCents;

  return {
    subtotalCents,
    commissionCents,
    shippingCents,
    seguroCents,
    buyerChargeCents,
    applicationFeeCents,
    sellerNetCents,
  };
}

export function assertValidConnectMoneyFlow(flow: ConnectMoneyFlow) {
  if (flow.sellerNetCents < 0) {
    throw new Error('INVALID_CONNECT_ECONOMICS');
  }
}

/**
 * Per-seller allocation row for the single-modal multi-seller checkout.
 *
 * The buyer authorizes one platform PaymentIntent for `buyerTotalCents` across
 * all sellers; seller economics stay internal and are released later via a
 * shipment-scoped Transfer. `grossCents` is the seller's subtotal (their gross
 * take before platform deductions). The buyer never sees `shippingCents`,
 * `commissionCents`, or the per-seller net split.
 *
 * `shipmentId` is the durable correlation to the per-seller shipment that will
 * receive this row's net release during manual admin release. It MUST be
 * present and unique across rows so the release step can address each shipment
 * unambiguously instead of inferring correlation from `sellerId` alone.
 */
export interface AllocationRow {
  sellerId: string;
  shipmentId: string;
  grossCents: number;
  commissionCents: number;
  shippingCents: number;
  seguroCents: number;
  netCents: number;
}

export interface SellerAllocationInput {
  sellerId: string;
  /**
   * Durable id of the per-seller shipment this allocation row settles. Required
   * and unique across the input set so release can correlate each net amount to
   * exactly one shipment.
   */
  shipmentId: string;
  subtotalCents: number;
  /** Seller-paid shipping deduction. Free-to-buyer: never added to buyerTotal. */
  shippingCents: number;
}

export interface CheckoutAllocationOptions {
  commissionRate?: number;
  seguroRate?: number;
  seguroFixedCents?: number;
}

export interface CheckoutAllocation {
  rows: AllocationRow[];
  /** Total the buyer authorizes on the single platform PaymentIntent. */
  buyerTotalCents: number;
  totalGrossCents: number;
  totalCommissionCents: number;
  totalShippingCents: number;
  totalSeguroCents: number;
  /** Sum of seller net amounts to be released via Transfers later. */
  totalReleaseCents: number;
}

/**
 * Compute per-seller allocation rows for a single-modal multi-seller checkout.
 *
 * Buyer total = sum(subtotal + seguro) per seller; shipping is seller-paid and
 * excluded from the buyer charge. Each row's net = gross - commission -
 * shipping is the amount released to the seller during manual admin release.
 */
export function calculateCheckoutAllocation(
  sellers: SellerAllocationInput[],
  options: CheckoutAllocationOptions = {},
): CheckoutAllocation {
  if (!Array.isArray(sellers) || sellers.length === 0) {
    throw new Error('INVALID_CHECKOUT_INPUT:empty_sellers');
  }

  const seenSellerIds = new Set<string>();
  const seenShipmentIds = new Set<string>();
  const rows: AllocationRow[] = [];

  for (const input of sellers) {
    if (!input || typeof input.sellerId !== 'string' || !input.sellerId) {
      throw new Error('INVALID_CHECKOUT_INPUT:missing_seller_id');
    }
    if (seenSellerIds.has(input.sellerId)) {
      throw new Error('INVALID_CHECKOUT_INPUT:duplicate_seller_id');
    }
    seenSellerIds.add(input.sellerId);

    assertUniqueShipmentId(
      input.shipmentId,
      seenShipmentIds,
      'INVALID_CHECKOUT_INPUT',
    );

    const moneyFlow = calculateConnectMoneyFlow({
      subtotalCents: input.subtotalCents,
      shippingCents: input.shippingCents,
      commissionRate: options.commissionRate,
      seguroRate: options.seguroRate,
      seguroFixedCents: options.seguroFixedCents,
    });

    // Reuse the legacy validator so a seller with shipping larger than gross
    // fails before any PaymentIntent is created.
    assertValidConnectMoneyFlow(moneyFlow);

    rows.push({
      sellerId: input.sellerId,
      shipmentId: input.shipmentId,
      grossCents: moneyFlow.subtotalCents,
      commissionCents: moneyFlow.commissionCents,
      shippingCents: moneyFlow.shippingCents,
      seguroCents: moneyFlow.seguroCents,
      netCents: moneyFlow.sellerNetCents,
    });
  }

  return reduceCheckoutAllocation(rows);
}

/** Aggregate per-row allocation rows into a reconciled CheckoutAllocation. */
export function reduceCheckoutAllocation(
  rows: AllocationRow[],
): CheckoutAllocation {
  let buyerTotalCents = 0;
  let totalGrossCents = 0;
  let totalCommissionCents = 0;
  let totalShippingCents = 0;
  let totalSeguroCents = 0;
  let totalReleaseCents = 0;

  for (const row of rows) {
    totalGrossCents += row.grossCents;
    totalCommissionCents += row.commissionCents;
    totalShippingCents += row.shippingCents;
    totalSeguroCents += row.seguroCents;
    // Buyer pays gross + seguro per seller; shipping is seller-paid.
    buyerTotalCents += row.grossCents + row.seguroCents;
    totalReleaseCents += row.netCents;
  }

  return {
    rows,
    buyerTotalCents,
    totalGrossCents,
    totalCommissionCents,
    totalShippingCents,
    totalSeguroCents,
    totalReleaseCents,
  };
}

/**
 * Defensively validate the reconciliation invariants of a built allocation.
 *
 * Used when an allocation is reconstructed from PaymentIntent metadata or DB
 * rows before release. Throws on any inconsistency.
 */
export function assertValidCheckoutAllocation(
  allocation: CheckoutAllocation,
): void {
  const { rows, buyerTotalCents } = allocation;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('INVALID_ALLOCATION_RECONCILIATION:empty_rows');
  }

  let expectedBuyerTotal = 0;
  let expectedRelease = 0;
  let expectedGross = 0;
  let expectedCommission = 0;
  let expectedShipping = 0;
  let expectedSeguro = 0;
  const seenShipmentIds = new Set<string>();

  for (const row of rows) {
    assertCents('grossCents', row.grossCents);
    assertCents('commissionCents', row.commissionCents);
    assertCents('shippingCents', row.shippingCents);
    assertCents('seguroCents', row.seguroCents);
    assertCents('netCents', row.netCents);

    assertUniqueShipmentId(
      row.shipmentId,
      seenShipmentIds,
      'INVALID_ALLOCATION_RECONCILIATION',
    );

    if (row.netCents < 0) {
      throw new Error('INVALID_ALLOCATION_RECONCILIATION:negative_net');
    }

    // Per-row: gross == commission + shipping + net (seguro is buyer-paid, kept
    // by the platform, so it is NOT part of the seller's net reconciliation).
    if (
      row.commissionCents + row.shippingCents + row.netCents !==
      row.grossCents
    ) {
      throw new Error('INVALID_ALLOCATION_RECONCILIATION:row_breakdown');
    }

    expectedBuyerTotal += row.grossCents + row.seguroCents;
    expectedRelease += row.netCents;
    expectedGross += row.grossCents;
    expectedCommission += row.commissionCents;
    expectedShipping += row.shippingCents;
    expectedSeguro += row.seguroCents;
  }

  if (buyerTotalCents !== expectedBuyerTotal) {
    throw new Error('INVALID_ALLOCATION_RECONCILIATION:buyer_total');
  }
  if (allocation.totalGrossCents !== expectedGross) {
    throw new Error('INVALID_ALLOCATION_RECONCILIATION:total_gross');
  }
  if (allocation.totalCommissionCents !== expectedCommission) {
    throw new Error('INVALID_ALLOCATION_RECONCILIATION:total_commission');
  }
  if (allocation.totalShippingCents !== expectedShipping) {
    throw new Error('INVALID_ALLOCATION_RECONCILIATION:total_shipping');
  }
  if (allocation.totalSeguroCents !== expectedSeguro) {
    throw new Error('INVALID_ALLOCATION_RECONCILIATION:total_seguro');
  }
  if (allocation.totalReleaseCents !== expectedRelease) {
    throw new Error('INVALID_ALLOCATION_RECONCILIATION:total_release');
  }
}
