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
export type EscalationReason = 'refund_not_found' | 'refund_ambiguous';
/** Stripe keeps idempotency keys for 24 h; replay only while the key is surely alive. */
export const REFUND_REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
interface ProviderRefund {
  id: string;
  payment_intent: string;
  amount: number;
  status: string;
  failure_reason?: unknown;
}
/** Answer of `confirmBeforeRefund`: continue to the refund, or stop with a reason to log. */
export type CancellationConfirmation =
  { proceed: true } | { proceed: false; reason: string };
export interface ShipmentCancellationPorts<T> {
  context: CancellationContext;
  claim: (context: CancellationContext) => Promise<unknown>;
  /**
   * Optional gate called after a winning claim and before `prepare` (only the preparing
   * timeout passes it). A stop ends the run without prepare, start or refund. An answer
   * that is neither shape fails closed.
   */
  confirmBeforeRefund?: (
    winner: CancellationContext,
    claimToken: string,
  ) => Promise<CancellationConfirmation>;
  prepare: (winner: CancellationContext) => Promise<CancellationPlan>;
  start: (input: CancellationStartInput) => Promise<unknown>;
  refund: (
    request: CancellationRefundRequest,
    options: { idempotencyKey: string },
  ) => Promise<unknown>;
  recordRefund: (input: CancellationRefundRecordInput) => Promise<unknown>;
  /** Service RPC `fn_get_shipment_cancellation_recovery`: JSON null or the started operation. */
  loadRecovery: (shipmentId: string) => Promise<unknown>;
  /** All Stripe refunds of the PaymentIntent (an array). */
  listRefunds: (paymentIntentId: string) => Promise<unknown>;
  retrieveRefund: (refundId: string) => Promise<unknown>;
  /** Service RPC `fn_escalate_shipment_cancellation`: exactly `{ escalated: true }` the first time. */
  escalate: (shipmentId: string, reason: EscalationReason) => Promise<unknown>;
  /** Awaited; its own failure never changes the outcome. */
  reportCritical: (message: string, data: Record<string, unknown>) => unknown;
  now?: () => number;
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
function validWinner(
  winnerSource: unknown,
  actorId: unknown,
  reason: unknown,
): winnerSource is CancellationSource {
  return (
    source(winnerSource) &&
    nonblank(reason) &&
    (winnerSource === 'buyer' || winnerSource === 'seller'
      ? nonblank(actorId)
      : actorId === null)
  );
}
function validFrozenRequest(
  value: unknown,
  context: CancellationContext,
): value is CancellationRefundRequest {
  if (
    !record(value) ||
    Object.keys(value).length !== 4 ||
    !nonblank(value.payment_intent) ||
    !Number.isSafeInteger(value.amount) ||
    (value.amount as number) <= 0 ||
    value.reason !== 'requested_by_customer' ||
    !record(value.metadata)
  )
    return false;
  const metadata = value.metadata;
  return (
    Object.keys(metadata).length === 5 &&
    [
      'shipment_id',
      'order_id',
      'caller_role',
      'reason',
      'seguro_share_cents',
    ].every((key) => key in metadata) &&
    metadata.shipment_id === context.shipmentId &&
    metadata.order_id === context.orderId
  );
}
async function critical(
  ports: {
    reportCritical: ShipmentCancellationPorts<unknown>['reportCritical'];
  },
  message: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await ports.reportCritical(message, data);
  } catch {
    // Alerting must never change the money outcome.
  }
}
/**
 * Marks the operation escalated and alerts only for the call that newly set the
 * marker, so a stuck shipment alerts once. If the marker cannot be written the
 * alert is sent anyway: failing toward noise beats failing silent.
 */
async function escalateOnce(
  ports: ShipmentCancellationPorts<unknown>,
  reason: EscalationReason,
  message: string,
  data: Record<string, unknown>,
): Promise<void> {
  let result: unknown;
  try {
    result = await ports.escalate(String(data.shipmentId), reason);
  } catch {
    await critical(ports, message, { ...data, escalationFailed: true });
    return;
  }
  if (
    record(result) &&
    Object.keys(result).length === 1 &&
    result.escalated === true
  ) {
    await critical(ports, message, data);
  }
}
function providerRefund(value: unknown): ProviderRefund {
  if (
    !record(value) ||
    !nonblank(value.id) ||
    typeof value.status !== 'string' ||
    !nonblank(value.payment_intent) ||
    !Number.isSafeInteger(value.amount)
  ) {
    throw new ApiError(409, 'CANCELLATION_REFUND_UNCONFIRMED');
  }
  return value as unknown as ProviderRefund;
}
/** A refund found by recovery must belong to exactly this shipment. */
function recoveredRefund(value: unknown, shipmentId: string): ProviderRefund {
  const refund = providerRefund(value);
  const metadata = (refund as unknown as Record<string, unknown>).metadata;
  if (!record(metadata) || metadata.shipment_id !== shipmentId) {
    throw new ApiError(409, 'CANCELLATION_REFUND_UNCONFIRMED');
  }
  return refund;
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

/** Records the provider result and completes only on a recorded `succeeded`. */
async function settleRefund<T>(
  ports: ShipmentCancellationPorts<T>,
  refund: ProviderRefund,
  winner: CancellationContext,
  frozen: FrozenCancellation,
): Promise<{ status: 'cancelled'; value: T }> {
  const failure = {
    shipmentId: winner.shipmentId,
    refundId: refund.id,
    refundStatus: refund.status,
  };
  // Record Stripe's own values; the database validates them against the frozen request.
  let recorded: unknown;
  try {
    recorded = await ports.recordRefund({
      shipmentId: winner.shipmentId,
      refundId: refund.id,
      paymentIntentId: refund.payment_intent,
      amountCents: refund.amount,
      status: refund.status,
      failureReason:
        typeof refund.failure_reason === 'string'
          ? refund.failure_reason
          : null,
    });
  } catch (error) {
    await critical(ports, 'CANCELLATION_REFUND_RECORD_FAILED', failure);
    throw error;
  }
  if (
    !record(recorded) ||
    recorded.refund_id !== refund.id ||
    typeof recorded.refund_status !== 'string'
  ) {
    await critical(ports, 'CANCELLATION_REFUND_RECORD_FAILED', failure);
    throw new ApiError(500, 'CANCELLATION_REFUND_RECORD_INVALID');
  }
  if (recorded.refund_status !== 'succeeded') {
    throw new ApiError(409, 'CANCELLATION_REFUND_UNCONFIRMED');
  }
  return { status: 'cancelled', value: await ports.complete(winner, frozen) };
}

/**
 * Converges a started operation without new money movement: reuses the
 * recorded refund, finds it at Stripe by shipment metadata, or replays the
 * frozen request with the same idempotency key while that key is alive.
 */
async function recoverCancellation<T>(
  ports: ShipmentCancellationPorts<T>,
): Promise<
  { status: 'cancelled'; value: T } | { status: 'recovery_required' }
> {
  const { context } = ports;
  const key = `cancel_shipment_${context.shipmentId}`;
  const operation = await ports.loadRecovery(context.shipmentId);
  if (
    !record(operation) ||
    operation.operation_key !== key ||
    operation.order_id !== context.orderId ||
    !validWinner(operation.source, operation.actor_id, operation.reason) ||
    !validFrozenRequest(operation.refund_request, context) ||
    (operation.cancellation_loss_cents !== null &&
      (!Number.isSafeInteger(operation.cancellation_loss_cents) ||
        (operation.cancellation_loss_cents as number) < 0)) ||
    typeof operation.external_started_at !== 'string' ||
    !Number.isFinite(Date.parse(operation.external_started_at)) ||
    (operation.recovery_escalated_at !== null &&
      (typeof operation.recovery_escalated_at !== 'string' ||
        !Number.isFinite(Date.parse(operation.recovery_escalated_at))))
  ) {
    return { status: 'recovery_required' };
  }
  const winner: CancellationContext = {
    ...context,
    source: operation.source,
    actorId: typeof operation.actor_id === 'string' ? operation.actor_id : null,
    reason: operation.reason as string,
  };
  const frozen: FrozenCancellation = {
    operationKey: key,
    refundRequest: operation.refund_request,
    cancellationLossCents: operation.cancellation_loss_cents as number | null,
  };
  const refundId = operation.refund_id;
  const refundStatus = operation.refund_status;
  if (refundId !== null && refundId !== undefined) {
    if (!nonblank(refundId) || typeof refundStatus !== 'string') {
      return { status: 'recovery_required' };
    }
    if (refundStatus === 'succeeded') {
      return {
        status: 'cancelled',
        value: await ports.complete(winner, frozen),
      };
    }
    if (refundStatus === 'failed' || refundStatus === 'canceled') {
      return { status: 'recovery_required' };
    }
    const retrieved = recoveredRefund(
      await ports.retrieveRefund(refundId),
      context.shipmentId,
    );
    if (retrieved.id !== refundId) {
      throw new ApiError(409, 'CANCELLATION_REFUND_UNCONFIRMED');
    }
    return settleRefund(ports, retrieved, winner, frozen);
  }
  if (refundStatus !== null && refundStatus !== undefined) {
    return { status: 'recovery_required' };
  }
  // Already escalated and nothing recorded: no Stripe call, no repeat alert.
  if (operation.recovery_escalated_at !== null) {
    return { status: 'recovery_required' };
  }
  const listed = await ports.listRefunds(frozen.refundRequest.payment_intent);
  if (!Array.isArray(listed)) {
    throw new ApiError(409, 'CANCELLATION_REFUND_UNCONFIRMED');
  }
  const matches = listed.filter(
    (entry) =>
      record(entry) &&
      record(entry.metadata) &&
      entry.metadata.shipment_id === context.shipmentId,
  );
  if (matches.length > 1) {
    await escalateOnce(
      ports,
      'refund_ambiguous',
      'CANCELLATION_REFUND_AMBIGUOUS',
      {
        shipmentId: context.shipmentId,
        refundIds: matches.map((entry) => (entry as { id?: unknown }).id),
      },
    );
    return { status: 'recovery_required' };
  }
  if (matches.length === 1) {
    return settleRefund(
      ports,
      recoveredRefund(matches[0], context.shipmentId),
      winner,
      frozen,
    );
  }
  const elapsed =
    (ports.now ?? Date.now)() - Date.parse(operation.external_started_at);
  if (elapsed >= REFUND_REPLAY_WINDOW_MS) {
    await escalateOnce(
      ports,
      'refund_not_found',
      'CANCELLATION_REFUND_NOT_FOUND',
      {
        shipmentId: context.shipmentId,
        externalStartedAt: operation.external_started_at,
      },
    );
    return { status: 'recovery_required' };
  }
  // Same key and body: Stripe returns the original refund instead of a new one.
  const replayed = recoveredRefund(
    await ports.refund(frozen.refundRequest, {
      idempotencyKey: frozen.operationKey,
    }),
    context.shipmentId,
  );
  return settleRefund(ports, replayed, winner, frozen);
}

/**
 * Claims before reconstruction; a confirmed atomic start is mandatory before Stripe.
 * The provider result is recorded durably and only a recorded `succeeded`
 * refund completes the cancellation. A claim in `recovery_required` converges
 * the started operation without new money movement (see recoverCancellation).
 */
export async function runShipmentCancellation<T>(
  ports: ShipmentCancellationPorts<T>,
): Promise<
  | { status: 'cancelled'; value: T }
  | { status: 'busy' | 'recovery_required' }
  | { status: 'carrier_pending'; reason: string }
> {
  const reservation = await ports.claim(ports.context);
  if (record(reservation) && reservation.status === 'busy') {
    return { status: 'busy' };
  }
  if (record(reservation) && reservation.status === 'recovery_required') {
    return recoverCancellation(ports);
  }
  const key = `cancel_shipment_${ports.context.shipmentId}`;
  if (
    !record(reservation) ||
    reservation.status !== 'claimed' ||
    reservation.operation_key !== key ||
    !nonblank(reservation.claim_token) ||
    !validWinner(reservation.source, reservation.actor_id, reservation.reason)
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
    reason: reservation.reason as string,
  };
  if (ports.confirmBeforeRefund) {
    const confirmation: unknown = await ports.confirmBeforeRefund(
      winner,
      reservation.claim_token,
    );
    if (record(confirmation) && confirmation.proceed === false) {
      if (!nonblank(confirmation.reason)) {
        throw new ApiError(500, 'CANCELLATION_CONFIRMATION_INVALID');
      }
      return { status: 'carrier_pending', reason: confirmation.reason };
    }
    if (!record(confirmation) || confirmation.proceed !== true) {
      throw new ApiError(500, 'CANCELLATION_CONFIRMATION_INVALID');
    }
  }
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
  const refund = providerRefund(
    await ports.refund(frozen.refundRequest, {
      idempotencyKey: frozen.operationKey,
    }),
  );
  return settleRefund(ports, refund, winner, frozen);
}
