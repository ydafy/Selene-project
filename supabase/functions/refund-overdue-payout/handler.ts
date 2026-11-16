/**
 * @file supabase/functions/refund-overdue-payout/handler.ts
 *
 * Admin refund of an overdue held payout (#549, S3): the shipment is completed, was never
 * transferred, has been held 30 days or more, and Stripe rejected the seller's account, so the
 * buyer gets back what they paid for that shipment. The amount is computed here from the order
 * and the Stripe charge, never taken from the client. The Stripe refund runs through the
 * shipment cancellation operation (`runShipmentCancellation`): claim, frozen request, Stripe
 * refund with the operation's idempotency key, record, and only a recorded `succeeded` refund
 * completes (`fn_complete_overdue_payout_refund`). A started refund is recovered, never
 * repeated. Raw database and Stripe text only reaches the log.
 */

import {
  ApiError,
  type ShipmentCancelItem,
} from '../_shared/cancellation/refund-basis.ts';
import {
  runShipmentCancellation,
  type CancellationRefundRecordInput,
  type CancellationRefundRequest,
  type CancellationStartInput,
  type EscalationReason,
} from '../_shared/cancellation/shipment-cancellation.ts';
import { buildStripeFeeReconciliationPlan } from '../stripe-webhooks/single-modal-settlement.ts';
import {
  buildOverdueRefundPlan,
  isStripeRejectedAccount,
  mapClaimError,
  mapStartError,
  readCardCharge,
  type OverdueCharge,
} from './overdue-refund.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The reason `fn_claim_overdue_payout_refund` stores; the start checks the refund metadata against it. */
const OVERDUE_REASON = 'overdue_payout_seller_rejected';

/** The shipment as `admin_connect_payout_release_view` reports it. */
export type OverdueShipment = {
  shipment_id: string;
  order_id: string;
  status: string | null;
  stripe_payment_intent_id: string | null;
  stripe_account_id: string | null;
  stripe_onboarding_status: string | null;
  is_payout_overdue: boolean | null;
};

export type OverdueOrder = {
  stripe_payment_intent_id: string | null;
  actual_stripe_fee_cents: number | null;
  items: ShipmentCancelItem[];
};

type RpcResult = Promise<{ data: unknown; error: { message: string } | null }>;

export type RefundOverduePayoutDeps = {
  /** The user id behind the access token, or null when it does not resolve to a user. */
  getUserId: (accessToken: string) => Promise<string | null>;
  /** True only for an active admin (see isActiveAdmin); throws when the lookup fails. */
  isAdmin: (userId: string) => Promise<boolean>;
  /** Null when no shipment has that id; throws when the read fails. */
  loadShipment: (shipmentId: string) => Promise<OverdueShipment | null>;
  /** `fn_get_shipment_cancellation_recovery`: JSON null or the started operation. */
  loadStartedOperation: (shipmentId: string) => Promise<unknown>;
  loadOrder: (orderId: string) => Promise<OverdueOrder | null>;
  /** Stores the fee read from Stripe when the order has none yet, as `cancel-order` does. */
  saveActualStripeFee: (
    orderId: string,
    feeCents: number,
    reconciledAt: string,
  ) => Promise<void>;
  retrieveAccount: (accountId: string) => Promise<unknown>;
  /** The PaymentIntent with `latest_charge.balance_transaction` expanded. */
  retrievePaymentIntent: (paymentIntentId: string) => Promise<unknown>;
  claim: (input: { adminId: string; shipmentId: string }) => RpcResult;
  start: (input: CancellationStartInput) => RpcResult;
  createRefund: (
    request: CancellationRefundRequest,
    options: { idempotencyKey: string },
  ) => Promise<unknown>;
  recordRefund: (input: CancellationRefundRecordInput) => RpcResult;
  /** Every refund of the PaymentIntent, as an array. */
  listRefunds: (paymentIntentId: string) => Promise<unknown>;
  retrieveRefund: (refundId: string) => Promise<unknown>;
  escalate: (shipmentId: string, reason: EscalationReason) => RpcResult;
  /** `fn_complete_overdue_payout_refund`. */
  complete: (shipmentId: string) => RpcResult;
  /** CRITICAL log plus a Sentry message; never throws. */
  reportCritical: (message: string, data: Record<string, unknown>) => unknown;
  log: (
    level: 'INFO' | 'WARN' | 'ERROR',
    msg: string,
    data?: Record<string, unknown>,
  ) => unknown;
  now?: () => number;
};

export type RefundOverduePayoutResult = {
  status: 'refunded' | 'pending';
  shipment_id: string;
  refund_id: string;
  amount_cents: number;
};

const respond = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const fail = (status: number, code: string): Response =>
  respond(status, { error: code });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Codes from the shared coordinator that only mean "the server could not do it". */
function toResponse(error: unknown): Response {
  if (!(error instanceof ApiError)) return fail(500, 'INTERNAL_ERROR');
  if (error.message === 'CANCELLATION_REFUND_UNCONFIRMED') {
    return fail(409, 'REFUND_UNCONFIRMED');
  }
  if (
    error.status === 422 ||
    (error.status >= 500 && error.message.startsWith('CANCELLATION_'))
  ) {
    return fail(500, 'INTERNAL_ERROR');
  }
  return fail(error.status, error.message);
}

export function createRefundOverduePayoutHandler(
  deps: RefundOverduePayoutDeps,
) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');

    let shipmentId = '';
    try {
      const authorization = req.headers.get('Authorization') ?? '';
      const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : '';
      if (!token) return fail(401, 'AUTH_REQUIRED');

      const adminId = await deps.getUserId(token);
      if (!adminId) return fail(401, 'AUTH_REQUIRED');

      if (!(await deps.isAdmin(adminId))) return fail(403, 'ADMIN_ONLY');

      // Only the shipment id is read from the body: the amount is always the server's.
      const body = asRecord(await req.json().catch(() => null));
      const requested = body?.shipment_id;
      if (typeof requested !== 'string' || !UUID.test(requested)) {
        return fail(422, 'INVALID_SHIPMENT_ID');
      }
      // Stored ids are lowercase and the refund plan compares them as strings.
      shipmentId = requested.toLowerCase();

      const stripeCall = async <T>(
        action: string,
        call: () => Promise<T>,
      ): Promise<T> => {
        try {
          return await call();
        } catch (error: unknown) {
          deps.log('ERROR', 'Stripe request failed', {
            shipmentId,
            action,
            error: errorText(error),
          });
          throw new ApiError(502, 'STRIPE_REQUEST_FAILED');
        }
      };

      const shipment = await deps.loadShipment(shipmentId);
      if (!shipment) return fail(404, 'SHIPMENT_NOT_FOUND');

      // A started refund may already exist at Stripe: recovering it never depends on the
      // eligibility checks below, which only guard a new refund.
      const started = asRecord(await deps.loadStartedOperation(shipmentId));
      const resuming = started?.source === 'admin_overdue_payout';

      let order: OverdueOrder | null = null;
      let paymentIntentId = '';
      if (!resuming) {
        // Cheap database checks first, so a refusal never reaches Stripe. The claim RPC
        // re-checks all of them, and more, while it holds the shipment lock.
        if (shipment.status !== 'completed') {
          return fail(409, 'SHIPMENT_NOT_COMPLETED');
        }
        if (shipment.is_payout_overdue !== true) {
          return fail(409, 'PAYOUT_NOT_OVERDUE');
        }
        const accountId = shipment.stripe_account_id;
        if (shipment.stripe_onboarding_status !== 'rejected' || !accountId) {
          return fail(409, 'SELLER_ACCOUNT_NOT_REJECTED');
        }
        const account = await stripeCall('retrieve_account', () =>
          deps.retrieveAccount(accountId),
        );
        if (!isStripeRejectedAccount(account)) {
          return fail(409, 'SELLER_ACCOUNT_NOT_REJECTED');
        }

        order = await deps.loadOrder(shipment.order_id);
        if (!order) throw new Error('ORDER_NOT_FOUND');
        paymentIntentId =
          shipment.stripe_payment_intent_id ??
          order.stripe_payment_intent_id ??
          '';
        if (!paymentIntentId) throw new Error('PAYMENT_INTENT_NOT_FOUND');
        const charge = readCardCharge(
          await stripeCall('retrieve_payment_intent', () =>
            deps.retrievePaymentIntent(paymentIntentId),
          ),
        );
        if (charge === 'not_card') {
          return fail(409, 'PAYMENT_METHOD_NOT_REFUNDABLE');
        }
        if (!charge) throw new Error('CHARGE_UNUSABLE');
      }

      const loadCharge = async (): Promise<OverdueCharge> => {
        // Read again after the claim: another shipment of the order may have been refunded.
        const charge = readCardCharge(
          await stripeCall('retrieve_payment_intent', () =>
            deps.retrievePaymentIntent(paymentIntentId),
          ),
        );
        if (charge === 'not_card') {
          throw new ApiError(409, 'PAYMENT_METHOD_NOT_REFUNDABLE');
        }
        if (!charge) throw new Error('CHARGE_UNUSABLE');
        return charge;
      };

      const rpc = async (
        name: string,
        call: RpcResult,
        mapError: (message: string) => ApiError,
      ): Promise<unknown> => {
        const { data, error } = await call;
        if (error) {
          deps.log('ERROR', `${name} failed`, {
            shipmentId,
            error: error.message,
          });
          throw mapError(error.message);
        }
        return data;
      };

      const result = await runShipmentCancellation({
        context: {
          shipmentId,
          orderId: shipment.order_id,
          actorId: adminId,
          source: 'admin_overdue_payout',
          reason: OVERDUE_REASON,
        },
        claim: () =>
          rpc(
            'fn_claim_overdue_payout_refund',
            deps.claim({ adminId, shipmentId }),
            mapClaimError,
          ),
        prepare: async () => {
          // Only a new claim prepares, and only after the checks above loaded the order.
          if (!order) throw new Error('ORDER_NOT_LOADED');
          const currentOrder = order;
          const charge = await loadCharge();
          let actualStripeFeeCents = currentOrder.actual_stripe_fee_cents;
          if (actualStripeFeeCents === null) {
            const feePlan = buildStripeFeeReconciliationPlan({
              existingActualStripeFeeCents: null,
              charge: {
                id: paymentIntentId,
                balance_transaction:
                  charge.stripeFeeCents === null
                    ? null
                    : { fee: charge.stripeFeeCents },
              },
              reconciledAt: new Date((deps.now ?? Date.now)()).toISOString(),
            });
            if (feePlan.kind === 'ready') {
              actualStripeFeeCents = feePlan.actualStripeFeeCents;
              try {
                await deps.saveActualStripeFee(
                  shipment.order_id,
                  feePlan.actualStripeFeeCents,
                  feePlan.stripeFeeReconciledAt,
                );
              } catch (error: unknown) {
                deps.log('WARN', 'Could not store the Stripe fee', {
                  shipmentId,
                  error: errorText(error),
                });
              }
            }
          }
          let plan;
          try {
            plan = buildOverdueRefundPlan({
              shipmentId,
              orderItems: currentOrder.items,
              charge,
              actualStripeFeeCents,
            });
          } catch (error: unknown) {
            deps.log('ERROR', 'Overdue refund amount unavailable', {
              shipmentId,
              error: errorText(error),
            });
            throw error instanceof ApiError &&
              error.message === 'REFUND_AMOUNT_EXCEEDS_CAP'
              ? new ApiError(409, 'REFUND_AMOUNT_EXCEEDS_CAP')
              : new ApiError(500, 'REFUND_AMOUNT_INVALID');
          }
          return { paymentIntentId, ...plan };
        },
        start: (input) =>
          rpc(
            'fn_start_shipment_cancellation_refund',
            deps.start(input),
            mapStartError,
          ),
        refund: (request, options) =>
          stripeCall('create_refund', () =>
            deps.createRefund(request, options),
          ),
        recordRefund: (input) =>
          rpc(
            'fn_record_shipment_cancellation_refund',
            deps.recordRefund(input),
            () => new ApiError(500, 'REFUND_RECORD_FAILED'),
          ),
        loadRecovery: (id) => deps.loadStartedOperation(id),
        listRefunds: (id) =>
          stripeCall('list_refunds', () => deps.listRefunds(id)),
        retrieveRefund: (id) =>
          stripeCall('retrieve_refund', () => deps.retrieveRefund(id)),
        escalate: (id, reason) =>
          rpc(
            'fn_escalate_shipment_cancellation',
            deps.escalate(id, reason),
            () => new ApiError(500, 'REFUND_ESCALATION_FAILED'),
          ),
        reportCritical: deps.reportCritical,
        now: deps.now,
        complete: async (_winner, frozen) => {
          const { data, error } = await deps.complete(shipmentId);
          const row = asRecord(data);
          if (
            error ||
            row?.shipment_status !== 'refunded' ||
            typeof row.refund_id !== 'string' ||
            row.refund_id === '' ||
            row.refund_amount_cents !== frozen.refundRequest.amount
          ) {
            // Stripe already returned the money: a human must see a shipment left behind.
            await deps.reportCritical('OVERDUE_REFUND_COMPLETION_FAILED', {
              shipmentId,
              error: error?.message ?? 'unusable completion result',
            });
            throw new ApiError(500, 'REFUND_COMPLETION_FAILED');
          }
          return {
            refundId: row.refund_id,
            amountCents: frozen.refundRequest.amount,
          };
        },
      });

      switch (result.status) {
        case 'cancelled': {
          deps.log('INFO', 'Overdue payout refunded', {
            shipmentId,
            adminId,
            refundId: result.value.refundId,
            amountCents: result.value.amountCents,
          });
          return respond(200, {
            status: 'refunded',
            shipment_id: shipmentId,
            refund_id: result.value.refundId,
            amount_cents: result.value.amountCents,
          } satisfies RefundOverduePayoutResult);
        }
        case 'refund_unsettled': {
          deps.log('WARN', 'Overdue payout refund not settled', {
            shipmentId,
            adminId,
            refundId: result.refundId,
            refundStatus: result.refundStatus,
          });
          if (
            result.refundStatus === 'pending' ||
            result.refundStatus === 'requires_action'
          ) {
            // The refund.updated webhook completes it (fn_apply_shipment_cancellation_refund_event).
            return respond(202, {
              status: 'pending',
              shipment_id: shipmentId,
              refund_id: result.refundId,
              amount_cents: result.amountCents,
            } satisfies RefundOverduePayoutResult);
          }
          // Failed or canceled: the admin repays by hand through resolve-shipment-refund (L11).
          return fail(409, 'REFUND_FAILED');
        }
        case 'busy':
          return fail(409, 'REFUND_IN_PROGRESS');
        case 'recovery_required':
          return fail(409, 'REFUND_RECOVERY_REQUIRED');
        case 'carrier_pending':
          // No carrier gate is passed; reaching it is a server fault.
          return fail(500, 'INTERNAL_ERROR');
        default: {
          const unreachable: never = result;
          return unreachable;
        }
      }
    } catch (error: unknown) {
      deps.log('ERROR', 'Overdue payout refund failed', {
        shipmentId,
        error: errorText(error),
      });
      return toResponse(error);
    }
  };
}
