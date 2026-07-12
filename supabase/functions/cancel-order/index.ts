import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

import {
  ApiError,
  parseCancelOrderRequestBody,
  resolveManualShipmentCancelPlan,
  type ShipmentCancelItem,
} from './cancel-order.ts';
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

// Legacy deployed name kept for compatibility.
// Manual cancellations are shipment-scoped and never whole-order here.
serve(async (req) => {
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
    } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
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
        refundCharge = (await stripe.charges.retrieve(order.stripe_charge_id, {
          expand: ['balance_transaction'],
        })) as Stripe.Charge;
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
          log('WARN', 'Could not persist on-demand Stripe fee reconciliation', {
            orderId,
            error: feeUpdateError.message,
          });
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
      callerRole: isSeller ? 'seller' : 'buyer',
      callerId: user.id,
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
      reason,
      onCritical: (message, metadata) => log('CRITICAL', message, metadata),
    });

    try {
      await stripe.refunds.create(plan.refundParams.params, plan.refundParams.options);
    } catch (stripeError: unknown) {
      const code =
        typeof stripeError === 'object' && stripeError !== null
          ? (stripeError as { code?: string }).code
          : null;

      if (code === 'charge_already_refunded') {
        log('WARN', 'Charge already refunded', { shipmentId });
      } else {
        const msg =
          stripeError instanceof Error ? stripeError.message : String(stripeError);
        log('ERROR', 'Stripe refund failed', {
          shipmentId,
          error: msg,
        });
        throw new ApiError(500, `Error de Stripe: ${msg}`);
      }
    }

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'fn_cancel_shipment',
      plan.rpcInput,
    );

    if (rpcError || !rpcData?.[0]?.success) {
      log('CRITICAL', 'Refund processed but shipment cancel RPC failed', {
        orderId,
        shipmentId,
        dbError: rpcError?.message || rpcData?.[0]?.error_message,
      });
      throw new ApiError(
        500,
        'Dinero devuelto, pero error al actualizar inventario. Soporte técnico ha sido notificado.',
      );
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
});
