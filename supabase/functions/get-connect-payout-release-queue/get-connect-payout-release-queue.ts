export interface ConnectPayoutReleaseQueueRow {
  shipment_id: string | null;
  seller_id: string | null;
  seller_name: string | null;
  order_id: string | null;
  status: string | null;
  completed_at: string | null;
  is_eligible: boolean | null;
  ineligible_reason: string | null;
  release_amount_cents: number | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: string | null;
  stripe_payment_intent_id: string | null;
}

export interface ConnectPayoutReleaseBatch {
  sellerId: string;
  sellerName: string | null;
  stripeAccountId: string;
  releaseAmountCents: number;
  shipmentIds: string[];
  shipments: ConnectPayoutReleaseQueueRow[];
}

export interface RejectedConnectPayoutReleaseRow {
  shipmentId: string | null;
  sellerId: string | null;
  sellerName: string | null;
  reason: string;
  releaseAmountCents: number;
}

export interface ConnectPayoutReleaseQueueResponse {
  success: true;
  eligibleBatches: ConnectPayoutReleaseBatch[];
  rejected: RejectedConnectPayoutReleaseRow[];
}

export class ConnectPayoutReleaseQueueError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ConnectPayoutReleaseQueueError';
  }
}

export function assertAdminProfile(
  profile: { role: string | null } | null,
): void {
  if (profile?.role !== 'admin') {
    throw new ConnectPayoutReleaseQueueError('ADMIN_REQUIRED', 403);
  }
}

export function getQueueErrorStatus(message: string): number {
  if (message === 'AUTH_REQUIRED') return 401;
  if (message === 'ADMIN_REQUIRED') return 403;
  if (message === 'MISSING_SERVER_CONFIG') return 500;
  return 400;
}

export function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function buildConnectPayoutReleaseQueue(
  rows: ConnectPayoutReleaseQueueRow[],
): ConnectPayoutReleaseQueueResponse {
  const batchMap = new Map<string, ConnectPayoutReleaseBatch>();
  const rejected: RejectedConnectPayoutReleaseRow[] = [];

  for (const row of rows) {
    const releaseAmountCents = row.release_amount_cents ?? 0;
    if (
      row.is_eligible !== true ||
      !row.seller_id ||
      !row.shipment_id ||
      !row.stripe_account_id
    ) {
      rejected.push({
        shipmentId: row.shipment_id,
        sellerId: row.seller_id,
        sellerName: row.seller_name,
        reason: row.ineligible_reason ?? 'not_payout_ready',
        releaseAmountCents,
      });
      continue;
    }

    const existing = batchMap.get(row.seller_id);
    if (existing) {
      existing.releaseAmountCents += releaseAmountCents;
      existing.shipmentIds.push(row.shipment_id);
      existing.shipments.push(row);
      continue;
    }

    batchMap.set(row.seller_id, {
      sellerId: row.seller_id,
      sellerName: row.seller_name,
      stripeAccountId: row.stripe_account_id,
      releaseAmountCents,
      shipmentIds: [row.shipment_id],
      shipments: [row],
    });
  }

  return {
    success: true,
    eligibleBatches: [...batchMap.values()],
    rejected,
  };
}
