import type {
  ConnectPayoutReleaseQueueRow,
  ConnectPayoutReleaseRequest,
} from '@selene/types';

export type ReleaseQueueShipmentIndicator = 'ready_for_release' | 'blocked';

export type ReleaseQueueBatchState = 'ready' | 'partial' | 'blocked';

export interface ReleaseQueueShipment {
  completedAt: string | null;
  ineligibleReason: string | null;
  isEligible: boolean;
  orderId: string;
  releaseAmountCents: number;
  reconciliationIndicator: ReleaseQueueShipmentIndicator;
  shipmentId: string;
  status: string | null;
  stripePaymentIntentId: string | null;
}

export interface ReleaseQueueBatch {
  sellerId: string;
  sellerName: string | null;
  stripeAccountId: string | null;
  totalEligibleAmountCents: number;
  eligibleShipmentCount: number;
  ineligibleShipmentCount: number;
  releaseState: ReleaseQueueBatchState;
  shipments: ReleaseQueueShipment[];
}

interface BuildReleasePayloadInput {
  batch: ReleaseQueueBatch;
  selectedShipmentIds: string[];
  idempotencyKey: string;
}

function isSelectableReleaseRow(row: ConnectPayoutReleaseQueueRow): boolean {
  return Boolean(
    row.is_eligible &&
    row.seller_id &&
    row.shipment_id &&
    row.order_id &&
    (row.release_amount_cents ?? 0) > 0,
  );
}

function resolveBatchState(
  eligibleShipmentCount: number,
  ineligibleShipmentCount: number,
): ReleaseQueueBatchState {
  if (eligibleShipmentCount === 0) return 'blocked';
  if (ineligibleShipmentCount > 0) return 'partial';
  return 'ready';
}

export function groupConnectPayoutReleaseQueue(
  rows: ConnectPayoutReleaseQueueRow[],
): ReleaseQueueBatch[] {
  const batchBySeller = new Map<string, ReleaseQueueBatch>();

  for (const row of rows) {
    if (!row.seller_id || !row.shipment_id || !row.order_id) continue;

    const isEligible = isSelectableReleaseRow(row);
    const releaseAmountCents = row.release_amount_cents ?? 0;
    const existing = batchBySeller.get(row.seller_id);
    const batch =
      existing ??
      ({
        sellerId: row.seller_id,
        sellerName: row.seller_name,
        stripeAccountId: row.stripe_account_id,
        totalEligibleAmountCents: 0,
        eligibleShipmentCount: 0,
        ineligibleShipmentCount: 0,
        releaseState: 'blocked',
        shipments: [],
      } satisfies ReleaseQueueBatch);

    batch.shipments.push({
      completedAt: row.completed_at,
      ineligibleReason: isEligible
        ? null
        : (row.ineligible_reason ?? 'NOT_ELIGIBLE'),
      isEligible,
      orderId: row.order_id,
      releaseAmountCents,
      reconciliationIndicator: isEligible ? 'ready_for_release' : 'blocked',
      shipmentId: row.shipment_id,
      status: row.status,
      stripePaymentIntentId: row.stripe_payment_intent_id,
    });

    if (isEligible) {
      batch.eligibleShipmentCount += 1;
      batch.totalEligibleAmountCents += releaseAmountCents;
    } else {
      batch.ineligibleShipmentCount += 1;
    }
    batch.releaseState = resolveBatchState(
      batch.eligibleShipmentCount,
      batch.ineligibleShipmentCount,
    );

    batchBySeller.set(row.seller_id, batch);
  }

  return Array.from(batchBySeller.values()).sort((left, right) =>
    (left.sellerName ?? left.sellerId).localeCompare(
      right.sellerName ?? right.sellerId,
    ),
  );
}

export function getSelectedEligibleShipmentIds(
  batch: ReleaseQueueBatch,
  selectedShipmentIds: string[],
): string[] {
  const selected = new Set(selectedShipmentIds);

  return batch.shipments
    .filter(
      (shipment) => shipment.isEligible && selected.has(shipment.shipmentId),
    )
    .map((shipment) => shipment.shipmentId);
}

export function buildReleasePayload({
  batch,
  selectedShipmentIds,
  idempotencyKey,
}: BuildReleasePayloadInput): ConnectPayoutReleaseRequest {
  return {
    sellerId: batch.sellerId,
    shipmentIds: selectedShipmentIds,
    idempotencyKey,
  };
}

export function createReleaseIdempotencyKey(
  sellerId: string,
  shipmentIds: string[],
): string {
  return `admin-release:${sellerId}:${[...shipmentIds].sort().join(',')}`;
}
