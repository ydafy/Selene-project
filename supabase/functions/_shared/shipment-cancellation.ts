import type { Tables } from '../../../packages/types/src/index.ts';
import { ApiError } from './refund-basis.ts';

type Operation = Tables<'shipment_cancellation_operations'>;
export type CancellationSource =
  'buyer' | 'seller' | 'paid_timeout' | 'preparing_timeout';
export interface CancellationContext {
  shipmentId: Operation['shipment_id'];
  orderId: Operation['order_id'];
  actorId: Operation['actor_id'];
  source: CancellationSource;
  reason: Operation['reason'];
}
export interface CancellationPlan {
  paymentIntentId: string;
  amountCents: number;
  seguroShareCents: number;
  cancellationLossCents: Operation['cancellation_loss_cents'];
}
export interface CancellationRefundRequest {
  payment_intent: string;
  amount: number;
  reason: 'requested_by_customer';
  metadata: {
    shipment_id: string;
    order_id: string;
    caller_role: 'buyer' | 'seller' | 'system';
    reason: string;
    seguro_share_cents: number;
  };
}
export interface FrozenCancellation {
  operationKey: string;
  refundRequest: CancellationRefundRequest;
  cancellationLossCents: Operation['cancellation_loss_cents'];
}
export interface CancellationStartInput {
  shipmentId: string;
  claimToken: string;
  refundRequest: CancellationRefundRequest;
  cancellationLossCents: Operation['cancellation_loss_cents'];
}
export interface CancellationRefundRecordInput {
  shipmentId: string;
  refundId: string;
  paymentIntentId: string;
  amountCents: number;
  status: string;
  failureReason: string | null;
}
export interface ShipmentCancellationPorts<T> {
  context: CancellationContext;
  claim: (context: CancellationContext) => Promise<unknown>;
  prepare: (winner: CancellationContext) => Promise<CancellationPlan>;
  start: (input: CancellationStartInput) => Promise<unknown>;
  refund: (
    request: CancellationRefundRequest,
    options: { idempotencyKey: string },
  ) => Promise<unknown>;
  recordRefund: (input: CancellationRefundRecordInput) => Promise<unknown>;
  complete: (
    winner: CancellationContext,
    frozen: FrozenCancellation,
  ) => Promise<T>;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonblank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function source(value: unknown): value is CancellationSource {
  return (
    value === 'buyer' ||
    value === 'seller' ||
    value === 'paid_timeout' ||
    value === 'preparing_timeout'
  );
}
function matchesRequest(
  value: unknown,
  expected: CancellationRefundRequest,
): value is CancellationRefundRequest {
  if (
    !record(value) ||
    Object.keys(value).length !== 4 ||
    !record(value.metadata)
  )
    return false;
  const metadata = value.metadata;
  return (
    value.payment_intent === expected.payment_intent &&
    value.amount === expected.amount &&
    value.reason === expected.reason &&
    Object.keys(metadata).length === 5 &&
    Object.entries(expected.metadata).every(
      ([key, entry]) => metadata[key] === entry,
    )
  );
}

/**
 * Claims before reconstruction; a confirmed atomic start is mandatory before Stripe.
 * The provider result is recorded durably (B2) and only a recorded `succeeded`
 * refund completes the cancellation. No retries or recovery are performed here
 * (recovery is B2.2).
 */
export async function runShipmentCancellation<T>(
  ports: ShipmentCancellationPorts<T>,
): Promise<
  { status: 'cancelled'; value: T } | { status: 'busy' | 'recovery_required' }
> {
  const reservation = await ports.claim(ports.context);
  if (
    record(reservation) &&
    (reservation.status === 'busy' ||
      reservation.status === 'recovery_required')
  ) {
    return { status: reservation.status };
  }
  const key = `cancel_shipment_${ports.context.shipmentId}`;
  if (
    !record(reservation) ||
    reservation.status !== 'claimed' ||
    reservation.operation_key !== key ||
    !nonblank(reservation.claim_token) ||
    !source(reservation.source) ||
    !nonblank(reservation.reason) ||
    (reservation.source === 'buyer' || reservation.source === 'seller'
      ? !nonblank(reservation.actor_id)
      : reservation.actor_id !== null)
  ) {
    throw new ApiError(500, 'CANCELLATION_RESERVATION_INVALID');
  }
  // A pre-start lease takeover must keep the first actor/source/reason even
  // when a different eligible path now owns the token.
  const winner: CancellationContext = {
    ...ports.context,
    source: reservation.source,
    actorId:
      typeof reservation.actor_id === 'string' ? reservation.actor_id : null,
    reason: reservation.reason,
  };
  const plan = await ports.prepare(winner);
  if (
    !nonblank(plan.paymentIntentId) ||
    !Number.isSafeInteger(plan.amountCents) ||
    plan.amountCents <= 0 ||
    !Number.isSafeInteger(plan.seguroShareCents) ||
    plan.seguroShareCents < 0 ||
    plan.seguroShareCents > plan.amountCents ||
    (plan.cancellationLossCents !== null &&
      (!Number.isSafeInteger(plan.cancellationLossCents) ||
        plan.cancellationLossCents < 0))
  ) {
    throw new ApiError(422, 'INVALID_CANCELLATION_REFUND_REQUEST');
  }
  const request: CancellationRefundRequest = {
    payment_intent: plan.paymentIntentId,
    amount: plan.amountCents,
    reason: 'requested_by_customer',
    metadata: {
      shipment_id: winner.shipmentId,
      order_id: winner.orderId,
      caller_role:
        winner.source === 'buyer' || winner.source === 'seller'
          ? winner.source
          : 'system',
      reason: winner.reason,
      seguro_share_cents: plan.seguroShareCents,
    },
  };
  const started = await ports.start({
    shipmentId: winner.shipmentId,
    claimToken: reservation.claim_token,
    refundRequest: request,
    cancellationLossCents: plan.cancellationLossCents,
  });
  if (
    !record(started) ||
    started.operation_key !== key ||
    !matchesRequest(started.refund_request, request) ||
    (typeof started.cancellation_loss_cents !== 'number' &&
      started.cancellation_loss_cents !== null) ||
    started.cancellation_loss_cents !== plan.cancellationLossCents
  ) {
    throw new ApiError(500, 'CANCELLATION_START_INVALID');
  }
  const frozen: FrozenCancellation = {
    operationKey: started.operation_key,
    refundRequest: started.refund_request,
    cancellationLossCents: started.cancellation_loss_cents,
  };
  // An error, including charge_already_refunded, does not establish this
  // shipment's refund. Leave the durable fence for B2/manual recovery.
  const refund = await ports.refund(frozen.refundRequest, {
    idempotencyKey: frozen.operationKey,
  });
  if (
    !record(refund) ||
    !nonblank(refund.id) ||
    typeof refund.status !== 'string' ||
    !nonblank(refund.payment_intent) ||
    !Number.isSafeInteger(refund.amount)
  ) {
    throw new ApiError(409, 'CANCELLATION_REFUND_UNCONFIRMED');
  }
  // Record Stripe's own values; the database validates them against the frozen request.
  const recorded = await ports.recordRefund({
    shipmentId: winner.shipmentId,
    refundId: refund.id,
    paymentIntentId: refund.payment_intent,
    amountCents: refund.amount as number,
    status: refund.status,
    failureReason:
      typeof refund.failure_reason === 'string' ? refund.failure_reason : null,
  });
  if (
    !record(recorded) ||
    recorded.refund_id !== refund.id ||
    typeof recorded.refund_status !== 'string'
  ) {
    throw new ApiError(500, 'CANCELLATION_REFUND_RECORD_INVALID');
  }
  if (recorded.refund_status !== 'succeeded') {
    throw new ApiError(409, 'CANCELLATION_REFUND_UNCONFIRMED');
  }
  return { status: 'cancelled', value: await ports.complete(winner, frozen) };
}
