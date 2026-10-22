import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import {
  ApiError,
  parseCancelOrderRequestBody,
  resolveManualShipmentCancelPlan,
  type ShipmentCancelItem,
} from './cancel-order.ts';
import { createCancellationReporter } from '../_shared/cancellation-alerts.ts';
import { withSentry } from '../_shared/sentry.ts';
import { runShipmentCancellation } from '../_shared/shipment-cancellation.ts';
import { buildStripeFeeReconciliationPlan } from '../stripe-webhooks/single-modal-settlement.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'cancel-order',
      level,
      msg,
      ...data,
    }),
  );
};

const reportCritical = createCancellationReporter('cancel-order', log);

// Legacy deployed name kept for compatibility.
// Manual cancellations are shipment-scoped and never whole-order here.
serve(withSentry('cancel-order', async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { orderId, shipmentId, reason } = parseCancelOrderRequestBody(body);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new ApiError(401, 'AUTH_REQUIRED');

    // 1. Autenticación
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) throw new ApiError(401, 'No autorizado');

    const { data: systemSettings, error: settingsError } = await supabaseAdmin
      .from('system_settings')
      .select('is_maintenance')
      .eq('id', 1)
      .single();

    if (settingsError || !systemSettings) {
      throw new ApiError(500, 'SYSTEM_SETTINGS_NOT_FOUND');
    }

    if (systemSettings.is_maintenance) {
      throw new ApiError(503, 'MAINTENANCE_MODE');
    }

    const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecret) throw new ApiError(500, 'MISSING_STRIPE_SECRET_KEY');

    const stripe = new Stripe(stripeSecret, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(
        'buyer_id, total_amount, stripe_charge_id, actual_stripe_fee_cents, stripe_fee_reconciled_at',
      )
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      throw new ApiError(422, 'ORDER_NOT_FOUND');
    }

    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from('shipments')
      .select(
        'id, order_id, seller_id, status, stripe_payment_intent_id, stripe_transfer_id',
      )
      .eq('id', shipmentId)
      .eq('order_id', orderId)
      .single();

    if (shipmentError || !shipment) {
      throw new ApiError(422, 'SHIPMENT_ORDER_MISMATCH');
    }

    const isBuyer = !!order.buyer_id && order.buyer_id === user.id;
    const isSeller = shipment.seller_id === user.id;

    if (!isBuyer && !isSeller) {
      throw new ApiError(403, 'UNAUTHORIZED');
    }

    if (shipment.status !== 'paid') {
      throw new ApiError(422, 'SHIPMENT_NOT_CANCELABLE');
    }
    if (shipment.stripe_transfer_id) {
      log('CRITICAL', 'CRITICAL_TRANSFER_BLOCKED', {
        orderId,
        shipmentId,
        stripeTransferId: shipment.stripe_transfer_id,
      });
      throw new ApiError(409, 'STRIPE_TRANSFER_ALREADY_RELEASED');
    }
    if (!shipment.stripe_payment_intent_id) {
      throw new ApiError(500, 'PAYMENT_INTENT_NOT_FOUND');
    }

    // Stripe lookups for recovery: the raw Stripe message is logged, never returned.
    const stripeLookup = async <T>(
      action: 'list' | 'retrieve',
      call: () => Promise<T>,
    ): Promise<T> => {
      try {
        return await call();
      } catch (stripeError: unknown) {
        log('ERROR', 'Stripe refund lookup failed', {
          shipmentId,
          action,
          error:
            stripeError instanceof Error
              ? stripeError.message
              : String(stripeError),
        });
        throw new ApiError(500, 'CANCELLATION_REFUND_LOOKUP_FAILED');
      }
    };

    const result = await runShipmentCancellation({
      context: {
        orderId,
        shipmentId,
        actorId: user.id,
        source: isSeller ? 'seller' : 'buyer',
        reason,
      },
      claim: async (context) => {
        const { data, error } = await supabaseAdmin.rpc(
          'fn_claim_shipment_cancellation',
          {
            p_order_id: context.orderId,
            p_shipment_id: context.shipmentId,
            p_actor_id: context.actorId,
            p_source: context.source,
            p_reason: context.reason,
          },
        );
        if (error) {
          // Logs only: the RPC text may expose constraint or column names.
          log('ERROR', 'Cancellation claim RPC failed', {
            shipmentId,
            error: error.message,
          });
          throw new ApiError(409, 'CANCELLATION_CLAIM_FAILED');
        }
        return data;
      },
      prepare: async (winner) => {
        const { data: orderItems, error: itemsError } = await supabaseAdmin
          .from('order_items')
          .select('price_at_purchase, shipping_amount, shipment_id')
          .eq('order_id', orderId);

        if (itemsError) {
          throw new ApiError(500, 'ORDER_ITEMS_NOT_FOUND');
        }

        let refundCharge: Stripe.Charge | null = null;
        if (order.stripe_charge_id) {
          try {
            refundCharge = (await stripe.charges.retrieve(
              order.stripe_charge_id,
              {
                expand: ['balance_transaction'],
              },
            )) as Stripe.Charge;
          } catch {
            throw new ApiError(500, 'STRIPE_CHARGE_NOT_FOUND');
          }
        }

        let actualStripeFeeCents = order.actual_stripe_fee_cents ?? null;
        if (actualStripeFeeCents === null && refundCharge) {
          const feePlan = buildStripeFeeReconciliationPlan({
            existingActualStripeFeeCents: order.actual_stripe_fee_cents ?? null,
            charge: refundCharge as unknown as {
              id: string;
              balance_transaction?: string | { fee?: number | null } | null;
            },
            reconciledAt: new Date().toISOString(),
          });

          if (feePlan.kind === 'ready') {
            actualStripeFeeCents = feePlan.actualStripeFeeCents;
            const { error: feeUpdateError } = await supabaseAdmin
              .from('orders')
              .update({
                actual_stripe_fee_cents: feePlan.actualStripeFeeCents,
                stripe_fee_reconciled_at: feePlan.stripeFeeReconciledAt,
                updated_at: feePlan.stripeFeeReconciledAt,
              })
              .eq('id', orderId)
              .is('actual_stripe_fee_cents', null);

            if (feeUpdateError) {
              log(
                'WARN',
                'Could not persist on-demand Stripe fee reconciliation',
                {
                  orderId,
                  error: feeUpdateError.message,
                },
              );
            }
          } else {
            log('WARN', 'Stripe fee reconciliation unavailable during cancel', {
              orderId,
              chargeId: order.stripe_charge_id,
            });
          }
        }

        const orderChargeCents = refundCharge?.amount
          ? refundCharge.amount
          : Math.round(Number(order.total_amount) * 100);
        const remainingRefundableCents = refundCharge?.amount
          ? refundCharge.amount - refundCharge.amount_refunded
          : null;

        const plan = resolveManualShipmentCancelPlan({
          isMaintenance: false,
          // The plan validates a manual owner; timeout takeover metadata remains
          // authoritative in the coordinator's frozen provider request.
          callerRole: winner.source === 'seller' ? 'seller' : 'buyer',
          callerId:
            winner.source === 'seller'
              ? winner.actorId!
              : winner.source === 'buyer'
                ? winner.actorId!
                : order.buyer_id,
          orderId,
          orderBuyerId: order.buyer_id,
          shipmentSellerId: shipment.seller_id,
          shipmentId,
          shipmentOrderId: shipment.order_id,
          shipmentStatus: shipment.status,
          shipmentStripePaymentIntentId: shipment.stripe_payment_intent_id,
          shipmentStripeTransferId: shipment.stripe_transfer_id,
          shipmentItems: (orderItems ?? []).filter(
            (item) => item.shipment_id === shipmentId,
          ) as ShipmentCancelItem[],
          orderItems: (orderItems ?? []) as ShipmentCancelItem[],
          orderChargeCents,
          remainingRefundableCents,
          actualStripeFeeCents,
          reason: winner.reason,
          onCritical: (message, metadata) => log('CRITICAL', message, metadata),
        });

        return {
          paymentIntentId: shipment.stripe_payment_intent_id!,
          amountCents: plan.amountCents,
          seguroShareCents:
            plan.refundParams.params.metadata.seguro_share_cents,
          cancellationLossCents: plan.rpcInput.p_cancellation_loss_cents,
        };
      },
      start: async (input) => {
        const { data, error } = await supabaseAdmin.rpc(
          'fn_start_shipment_cancellation_refund',
          {
            p_shipment_id: input.shipmentId,
            p_claim_token: input.claimToken,
            p_refund_request: input.refundRequest,
            p_cancellation_loss_cents: input.cancellationLossCents,
          },
        );
        if (error) {
          log('ERROR', 'Cancellation start RPC failed', {
            shipmentId,
            error: error.message,
          });
          throw new ApiError(409, 'CANCELLATION_START_FAILED');
        }
        return data;
      },
      refund: (request, options) => {
        const fail = (stripeError: unknown): never => {
          const msg =
            stripeError instanceof Error
              ? stripeError.message
              : String(stripeError);
          log('ERROR', 'Stripe refund failed', {
            shipmentId,
            error: msg,
          });
          throw new ApiError(500, 'CANCELLATION_REFUND_PROVIDER_FAILED');
        };
        try {
          return stripe.refunds.create(request, options).catch(fail);
        } catch (stripeError: unknown) {
          return fail(stripeError);
        }
      },
      recordRefund: async (input) => {
        const { data, error } = await supabaseAdmin.rpc(
          'fn_record_shipment_cancellation_refund',
          {
            p_shipment_id: input.shipmentId,
            p_refund_id: input.refundId,
            p_payment_intent_id: input.paymentIntentId,
            p_amount_cents: input.amountCents,
            p_status: input.status,
            p_failure_reason: input.failureReason,
          },
        );
        if (error) {
          // Logs only: the RPC text may expose constraint or column names.
          log('ERROR', 'Cancellation refund record RPC failed', {
            shipmentId,
            error: error.message,
          });
          throw new ApiError(500, 'CANCELLATION_REFUND_RECORD_FAILED');
        }
        return data;
      },
      loadRecovery: async (recoveryShipmentId) => {
        const { data, error } = await supabaseAdmin.rpc(
          'fn_get_shipment_cancellation_recovery',
          { p_shipment_id: recoveryShipmentId },
        );
        if (error) {
          log('ERROR', 'Cancellation recovery lookup failed', {
            shipmentId,
            error: error.message,
          });
          throw new ApiError(500, 'CANCELLATION_RECOVERY_UNAVAILABLE');
        }
        return data;
      },
      listRefunds: (paymentIntentId) =>
        stripeLookup('list', () =>
          stripe.refunds
            .list({ payment_intent: paymentIntentId, limit: 100 })
            .autoPagingToArray({ limit: 1000 }),
        ),
      retrieveRefund: (refundId) =>
        stripeLookup('retrieve', () => stripe.refunds.retrieve(refundId)),
      escalate: async (escalatedShipmentId, reason) => {
        const { data, error } = await supabaseAdmin.rpc(
          'fn_escalate_shipment_cancellation',
          { p_shipment_id: escalatedShipmentId, p_reason: reason },
        );
        if (error) {
          log('ERROR', 'Cancellation escalation failed', {
            shipmentId,
            error: error.message,
          });
          throw new ApiError(500, 'CANCELLATION_ESCALATION_FAILED');
        }
        return data;
      },
      reportCritical,
      complete: async (winner, frozen) => {
        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_cancel_shipment',
          {
            p_shipment_id: winner.shipmentId,
            p_cancelled_by_role:
              winner.source === 'buyer' || winner.source === 'seller'
                ? winner.source
                : 'system',
            p_reason: winner.reason,
            p_cancellation_loss_cents: frozen.cancellationLossCents,
          },
        );

        if (rpcError || !rpcData?.[0]?.success) {
          await reportCritical('Refund processed but shipment cancel RPC failed', {
            orderId,
            shipmentId,
            dbError: rpcError?.message || rpcData?.[0]?.error_message,
          });
          throw new ApiError(
            500,
            'Dinero devuelto, pero error al actualizar inventario. Soporte técnico ha sido notificado.',
          );
        }
      },
    });
    if (result.status !== 'cancelled') {
      throw new ApiError(409, 'CANCELLATION_' + result.status.toUpperCase());
    }

    log('INFO', 'Cancelación de shipment completada con éxito', {
      orderId,
      shipmentId,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Shipment canceled and refund processed',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const status = error instanceof ApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'Fallo en proceso de cancelación', { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}));
