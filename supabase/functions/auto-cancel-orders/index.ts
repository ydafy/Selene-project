import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import type { Tables } from '../../../packages/types/src/index.ts';
import { createCancellationReporter } from '../_shared/cancellation-alerts.ts';
import {
  acquireAutoCancelLease,
  releaseAutoCancelLease,
} from '../_shared/auto-cancel-lease.ts';
import { withSentry } from '../_shared/sentry.ts';
import { runShipmentCancellation } from '../_shared/shipment-cancellation.ts';
import { resolveAutoCancelShipmentCancellationGate } from '../_shared/auto-cancel-safety.ts';
import {
  allocateCancellationLossCents,
  computeShipmentRefundAmountCents,
} from '../_shared/refund-basis.ts';
import { buildStripeFeeReconciliationPlan } from '../stripe-webhooks/single-modal-settlement.ts';

const STRIPE_API_VERSION = '2026-04-22.dahlia';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'auto-cancel-orders',
      level,
      msg,
      ...data,
    }),
  );
};

const reportCritical = createCancellationReporter('auto-cancel-orders', log);

serve(withSentry('auto-cancel-orders', async () => {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });

  let leaseId: string | undefined;

  try {
    log('INFO', 'Iniciando proceso de auto-cancelación');

    const lease = await acquireAutoCancelLease(supabaseAdmin, 'orders', log);
    if (!lease.acquired) return lease.response;
    leaseId = lease.leaseId;

    // 1. Obtener configuración
    const { data: settings } = await supabaseAdmin
      .from('system_settings')
      .select('order_expiration_hours')
      .single();

    const hours = settings?.order_expiration_hours || 48;
    const expirationLimit = new Date(
      Date.now() - hours * 60 * 60 * 1000,
    ).toISOString();

    // 2. Buscar shipments expirados sin tracking_number
    const { data: expiredShipments, error: fetchError } = await supabaseAdmin
      .from('shipments')
      .select(
        'id, order_id, seller_id, stripe_payment_intent_id, status, stripe_transfer_id',
      )
      .eq('status', 'paid')
      .is('tracking_number', null)
      .lt('created_at', expirationLimit)
      .limit(50);

    if (fetchError) throw fetchError;
    if (!expiredShipments || expiredShipments.length === 0) {
      log('INFO', 'No hay shipments para cancelar');

      return new Response(
        JSON.stringify({ message: 'No shipments to cancel' }),
        {
          status: 200,
        },
      );
    }

    log('INFO', `Procesando ${expiredShipments.length} shipments expirados`);

    let successCount = 0;
    let deferred = 0;

    for (const [index, shipment] of expiredShipments.entries()) {
      if (lease.budgetExceeded()) {
        deferred = expiredShipments.length - index;
        log(
          'WARN',
          'Auto-cancel run budget reached; remaining shipments wait for the next run',
          { deferred },
        );
        break;
      }

      try {
        const result = await runShipmentCancellation({
          context: {
            shipmentId: shipment.id,
            orderId: shipment.order_id,
            source: 'paid_timeout',
            actorId: null,
            reason: `Cancelación automática: Excedió el límite de ${hours} horas para envío.`,
          },
          claim: async (context) => {
            const { data, error } = await supabaseAdmin.rpc(
              'fn_claim_shipment_cancellation',
              {
                p_shipment_id: context.shipmentId,
                p_order_id: context.orderId,
                p_actor_id: context.actorId,
                p_source: context.source,
                p_reason: context.reason,
              },
            );
            if (error) throw new Error(error.message);
            return data;
          },
          prepare: async () => {
            // Reconstruct and persist fees only after winning the reservation.
            const { data: orderItems } = await supabaseAdmin
              .from('order_items')
              .select('price_at_purchase, shipping_amount, shipment_id')
              .eq('order_id', shipment.order_id);

            // Explicit shape assertion for Supabase dashboard editor compatibility
            const refundItems = (orderItems ?? []) as Pick<
              Tables<'order_items'>,
              'price_at_purchase' | 'shipping_amount' | 'shipment_id'
            >[];

            const shipmentItems = refundItems.filter(
              (item) => item.shipment_id === shipment.id,
            );

            const { data: order } = await supabaseAdmin
              .from('orders')
              .select(
                'stripe_charge_id, total_amount, stripe_payment_intent_id, actual_stripe_fee_cents, stripe_fee_reconciled_at',
              )
              .eq('id', shipment.order_id)
              .single();

            let refundCharge: Stripe.Charge | null = null;
            if (order?.stripe_charge_id) {
              try {
                refundCharge = (await stripe.charges.retrieve(
                  order.stripe_charge_id,
                  {
                    expand: ['balance_transaction'],
                  },
                )) as Stripe.Charge;
              } catch {
                throw new Error('STRIPE_CHARGE_NOT_FOUND');
              }
            }

            let actualStripeFeeCents = order?.actual_stripe_fee_cents ?? null;
            if (actualStripeFeeCents === null && refundCharge) {
              const feePlan = buildStripeFeeReconciliationPlan({
                existingActualStripeFeeCents:
                  order?.actual_stripe_fee_cents ?? null,
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
                  .eq('id', shipment.order_id)
                  .is('actual_stripe_fee_cents', null);

                if (feeUpdateError) {
                  log(
                    'WARN',
                    'Could not persist on-demand Stripe fee reconciliation',
                    {
                      shipmentId: shipment.id,
                      orderId: shipment.order_id,
                      error: feeUpdateError.message,
                    },
                  );
                }
              } else {
                log(
                  'WARN',
                  'Stripe fee reconciliation unavailable during auto-cancel',
                  {
                    shipmentId: shipment.id,
                    orderId: shipment.order_id,
                    chargeId: order?.stripe_charge_id,
                  },
                );
              }
            }

            const refundAmountCents = computeShipmentRefundAmountCents({
              shipmentItems,
              orderItems: refundItems,
              orderChargeCents: refundCharge?.amount
                ? refundCharge.amount
                : Math.round(Number(order?.total_amount ?? 0) * 100),
              remainingRefundableCents: refundCharge?.amount
                ? refundCharge.amount - refundCharge.amount_refunded
                : null,
            });

            const shipmentSubtotalCents = Math.round(
              shipmentItems.reduce(
                (sum, item) => sum + item.price_at_purchase,
                0,
              ) * 100,
            );
            const seguroShareCents = refundAmountCents - shipmentSubtotalCents;

            const orderShipmentGroups = new Map<string, typeof refundItems>();
            for (const item of refundItems) {
              if (
                typeof item.shipment_id !== 'string' ||
                item.shipment_id.length === 0
              ) {
                continue;
              }

              const group = orderShipmentGroups.get(item.shipment_id) ?? [];
              group.push(item);
              orderShipmentGroups.set(item.shipment_id, group);
            }

            const cancellationLossWeights =
              orderShipmentGroups.size > 0
                ? Array.from(orderShipmentGroups.entries()).map(
                    ([shipmentId, items]) => ({
                      shipmentId,
                      buyerRefundCents: computeShipmentRefundAmountCents({
                        shipmentItems: items.filter(
                          (item) => item.shipment_id === shipmentId,
                        ),
                        orderItems: refundItems,
                        orderChargeCents: refundCharge?.amount
                          ? refundCharge.amount
                          : Math.round(Number(order?.total_amount ?? 0) * 100),
                        // Entitlement weights use the original charge, not residual headroom.
                      }),
                    }),
                  )
                : [
                    {
                      shipmentId: shipment.id,
                      buyerRefundCents: refundAmountCents,
                    },
                  ];

            const cancellationLossAllocations = allocateCancellationLossCents(
              actualStripeFeeCents,
              cancellationLossWeights,
            );
            const cancellationLossCents =
              cancellationLossAllocations?.get(shipment.id) ?? null;

            // 4. Resolve PaymentIntent ID: Connect orders use shipment-level PI,
            // legacy orders use order-level PI (which is NULL for Connect per T-001).
            const stripePaymentIntentId =
              shipment.stripe_payment_intent_id ?? null;
            let orderStripeIntentId: string | null = null;

            if (!stripePaymentIntentId) {
              // Legacy: PI ID lives on the order
              orderStripeIntentId = order?.stripe_payment_intent_id ?? null;
            }

            const finalStripeIntentId =
              stripePaymentIntentId ?? orderStripeIntentId;

            const refundGate = resolveAutoCancelShipmentCancellationGate({
              finalStripeIntentId,
              refundAmountCents,
            });

            if (!refundGate.shouldCancelShipment) {
              log(refundGate.level, refundGate.message, {
                shipmentId: shipment.id,
                orderId: shipment.order_id,
                refundAmountCents,
                hasStripePaymentIntent: Boolean(finalStripeIntentId),
                errorCode: refundGate.code,
              });
              throw new Error(refundGate.code);
            }

            return {
              paymentIntentId: finalStripeIntentId!,
              amountCents: refundAmountCents,
              seguroShareCents,
              cancellationLossCents,
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
            if (error) throw new Error(error.message);
            return data;
          },
          refund: (request, options) => stripe.refunds.create(request, options),
          loadRecovery: async (shipmentId) => {
            const { data, error } = await supabaseAdmin.rpc(
              'fn_get_shipment_cancellation_recovery',
              { p_shipment_id: shipmentId },
            );
            if (error) {
              log('ERROR', 'Cancellation recovery lookup failed', {
                shipmentId,
                error: error.message,
              });
              throw new Error('CANCELLATION_RECOVERY_UNAVAILABLE');
            }
            return data;
          },
          // Stripe lookups for recovery: the raw Stripe message is logged, never surfaced.
          listRefunds: async (paymentIntentId) => {
            try {
              return await stripe.refunds
                .list({ payment_intent: paymentIntentId, limit: 100 })
                .autoPagingToArray({ limit: 1000 });
            } catch (stripeError) {
              log('ERROR', 'Stripe refund lookup failed', {
                shipmentId: shipment.id,
                action: 'list',
                error:
                  stripeError instanceof Error
                    ? stripeError.message
                    : String(stripeError),
              });
              throw new Error('CANCELLATION_REFUND_LOOKUP_FAILED');
            }
          },
          retrieveRefund: async (refundId) => {
            try {
              return await stripe.refunds.retrieve(refundId);
            } catch (stripeError) {
              log('ERROR', 'Stripe refund lookup failed', {
                shipmentId: shipment.id,
                action: 'retrieve',
                error:
                  stripeError instanceof Error
                    ? stripeError.message
                    : String(stripeError),
              });
              throw new Error('CANCELLATION_REFUND_LOOKUP_FAILED');
            }
          },
          escalate: async (escalatedShipmentId, reason) => {
            const { data, error } = await supabaseAdmin.rpc(
              'fn_escalate_shipment_cancellation',
              { p_shipment_id: escalatedShipmentId, p_reason: reason },
            );
            if (error) {
              log('ERROR', 'Cancellation escalation failed', {
                shipmentId: escalatedShipmentId,
                error: error.message,
              });
              throw new Error('CANCELLATION_ESCALATION_FAILED');
            }
            return data;
          },
          reportCritical,
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
            if (error) throw new Error(error.message);
            return data;
          },
          complete: async (winner, frozen) => {
            const { data, error } = await supabaseAdmin.rpc(
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
            if (error || !data?.[0]?.success) {
              await reportCritical(
                'Refund succeeded but database cancellation failed; manual review required',
                {
                  shipmentId: winner.shipmentId,
                  error: error?.message ?? data?.[0]?.error_message,
                },
              );
              throw new Error(
                error?.message ??
                  data?.[0]?.error_message ??
                  'CANCELLATION_FAILED',
              );
            }
            return frozen.refundRequest.amount;
          },
        });
        if (result.status === 'cancelled') {
          successCount++;
          log('INFO', 'Shipment cancelado exitosamente', {
            shipmentId: shipment.id,
            orderId: shipment.order_id,
            refundAmountCents: result.value,
          });
        } else {
          log('WARN', 'Shipment cancellation skipped', {
            shipmentId: shipment.id,
            status: result.status,
          });
        }

        // Delay para no saturar Stripe API
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        log('ERROR', `Excepción en loop para shipment ${shipment.id}`, {
          orderId: shipment.order_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log('INFO', 'Proceso finalizado', {
      total: expiredShipments.length,
      deferred,
      success: successCount,
    });

    return new Response(
      JSON.stringify({
        processed: expiredShipments.length - deferred,
        success: successCount,
        deferred,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    log('ERROR', 'Fallo crítico en auto-cancel-orders', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
      status: 500,
    });
  } finally {
    await releaseAutoCancelLease(supabaseAdmin, 'orders', leaseId, log);
  }
}));
