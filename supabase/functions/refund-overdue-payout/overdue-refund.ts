/**
 * @file supabase/functions/refund-overdue-payout/overdue-refund.ts
 *
 * Pure rules of the admin overdue payout refund (#549): the live Stripe rejection check, the
 * card-only charge read, the server-side amount and fee loss, and the stable codes for the SQL
 * errors. No I/O; handler.ts calls these.
 */

import {
  allocateCancellationLossCents,
  ApiError,
  computeShipmentRefundAmountCents,
  type ShipmentCancelItem,
} from '../_shared/cancellation/refund-basis.ts';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const cents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * True only when Stripe itself rejected the connected account (`requirements.disabled_reason`
 * starts with `rejected.`). The stored `rejected` onboarding status is broader (L3): it also
 * covers reasons such as `under_review` that Stripe may still lift.
 */
export function isStripeRejectedAccount(account: unknown): boolean {
  const reason = asRecord(asRecord(account)?.requirements)?.disabled_reason;
  return typeof reason === 'string' && reason.startsWith('rejected.');
}

export interface OverdueCharge {
  amountCents: number;
  amountRefundedCents: number;
  /** The Stripe fee from the balance transaction, or null when it is not expanded yet. */
  stripeFeeCents: number | null;
}

/**
 * Reads the PaymentIntent's latest charge (expanded with its balance transaction). Only a card
 * charge can be refunded by this path (S6, L2): Apple Pay and Google Pay are card charges.
 * Returns `not_card` for any other method and null for an unusable charge.
 */
export function readCardCharge(
  paymentIntent: unknown,
): OverdueCharge | 'not_card' | null {
  const charge = asRecord(asRecord(paymentIntent)?.latest_charge);
  if (!charge) return null;
  if (asRecord(charge.payment_method_details)?.type !== 'card') {
    return 'not_card';
  }
  if (
    !cents(charge.amount) ||
    charge.amount === 0 ||
    !cents(charge.amount_refunded) ||
    charge.amount_refunded > charge.amount
  ) {
    return null;
  }
  const fee = asRecord(charge.balance_transaction)?.fee;
  return {
    amountCents: charge.amount,
    amountRefundedCents: charge.amount_refunded,
    stripeFeeCents: cents(fee) ? fee : null,
  };
}

export interface OverdueRefundPlan {
  amountCents: number;
  seguroShareCents: number;
  cancellationLossCents: number | null;
}

/**
 * The refund is what the buyer paid for this shipment, computed as a cancellation (L4): its item
 * subtotal plus its proportional Seguro Selene share, capped by what the charge can still refund.
 * The fee loss is this shipment's share of the order's actual Stripe fee, weighted like
 * `cancel-order` weights a cancellation. Never a client amount.
 */
export function buildOverdueRefundPlan(input: {
  shipmentId: string;
  orderItems: ShipmentCancelItem[];
  charge: OverdueCharge;
  actualStripeFeeCents: number | null;
}): OverdueRefundPlan {
  const shipmentItems = input.orderItems.filter(
    (item) => item.shipment_id === input.shipmentId,
  );
  const amountCents = computeShipmentRefundAmountCents({
    shipmentItems,
    orderItems: input.orderItems,
    orderChargeCents: input.charge.amountCents,
    remainingRefundableCents:
      input.charge.amountCents - input.charge.amountRefundedCents,
  });

  const groups = new Map<string, ShipmentCancelItem[]>();
  for (const item of input.orderItems) {
    if (typeof item.shipment_id !== 'string' || item.shipment_id === '') {
      continue;
    }
    groups.set(item.shipment_id, [
      ...(groups.get(item.shipment_id) ?? []),
      item,
    ]);
  }
  const allocations = allocateCancellationLossCents(
    input.actualStripeFeeCents,
    [...groups.entries()].map(([shipmentId, items]) => ({
      shipmentId,
      buyerRefundCents: computeShipmentRefundAmountCents({
        shipmentItems: items,
        orderItems: input.orderItems,
        orderChargeCents: input.charge.amountCents,
      }),
    })),
  );

  const subtotalCents = shipmentItems.reduce(
    (sum, item) => sum + item.price_at_purchase_cents,
    0,
  );
  return {
    amountCents,
    seguroShareCents: amountCents - subtotalCents,
    cancellationLossCents: allocations?.get(input.shipmentId) ?? null,
  };
}

type Mapped = { status: number; code: string };

const passThrough = (code: string): Mapped => ({ status: 409, code });

/** `fn_claim_overdue_payout_refund` errors a caller can act on; anything else is a 500. */
const CLAIM_ERRORS: readonly { sql: string; mapped: Mapped }[] = [
  // The caller was an active admin a moment ago; the RPC re-checks it in its transaction.
  { sql: 'ADMIN_REQUIRED', mapped: { status: 403, code: 'ADMIN_ONLY' } },
  {
    sql: 'SHIPMENT_NOT_FOUND',
    mapped: { status: 404, code: 'SHIPMENT_NOT_FOUND' },
  },
  ...[
    'SHIPMENT_NOT_COMPLETED',
    'SHIPMENT_FUNDS_ALREADY_RELEASED',
    'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
    'PAYOUT_NOT_OVERDUE',
    'SELLER_ACCOUNT_NOT_REJECTED',
    'PAYOUT_RUN_NOT_PARKED',
    'SHIPMENT_CANCELLATION_OPERATION_ACTIVE',
    'SHIPMENT_ALREADY_REFUNDED',
  ].map((sql) => ({ sql, mapped: passThrough(sql) })),
];

/** `fn_start_shipment_cancellation_refund` errors: the shipment changed or the claim was lost. */
const START_ERRORS: readonly { sql: string; mapped: Mapped }[] = [
  ...[
    'SELLER_ACCOUNT_NOT_REJECTED',
    'SHIPMENT_FUNDS_ALREADY_RELEASED',
    'SHIPMENT_TRANSFER_OPERATION_ACTIVE',
  ].map((sql) => ({ sql, mapped: passThrough(sql) })),
  ...[
    'STALE_CANCELLATION_CLAIM',
    'CANCELLATION_CLAIM_EXPIRED',
    'CANCELLATION_EXTERNAL_ALREADY_STARTED',
  ].map((sql) => ({ sql, mapped: passThrough('REFUND_IN_PROGRESS') })),
];

const mapWith =
  (table: readonly { sql: string; mapped: Mapped }[]) =>
  (message: string): ApiError => {
    const found = table.find((entry) => message.includes(entry.sql));
    return found
      ? new ApiError(found.mapped.status, found.mapped.code)
      : new ApiError(500, 'INTERNAL_ERROR');
  };

export const mapClaimError = mapWith(CLAIM_ERRORS);
export const mapStartError = mapWith(START_ERRORS);
