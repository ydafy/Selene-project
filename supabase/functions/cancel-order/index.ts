import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const STRIPE_API_VERSION = '2026-04-22.dahlia';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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

const RequestSchema = z.object({
  orderId: z.string().uuid('ID de orden inválido'),
  reason: z
    .string()
    .max(255, 'La razón es demasiado larga')
    .optional()
    .default('Cancelación solicitada por el usuario'),
});

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { orderId, reason } = RequestSchema.parse(body);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 1. Autenticación
    const authHeader = req.headers.get('Authorization');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(
      authHeader?.replace('Bearer ', '') || '',
    );
    if (authError || !user) throw new ApiError(401, 'No autorizado');

    // 2. Obtener Orden y Validar Roles
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(
        `id, buyer_id, status, stripe_payment_intent_id, items:order_items(seller_id)`,
      )
      .eq('id', orderId)
      .single();

    if (orderError || !order) throw new ApiError(404, 'Orden no encontrada');

    let role: 'buyer' | 'seller' | 'system' = 'system';
    if (user.id === order.buyer_id) role = 'buyer';
    else if (
      order.items.some(
        (item: { seller_id: string }) => item.seller_id === user.id,
      )
    )
      role = 'seller';
    else throw new ApiError(403, 'No tienes permiso para cancelar esta orden');

    // 3. Validar Estado de la Orden
    if (order.status === 'cancelled') {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'La orden ya estaba cancelada',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (!['paid'].includes(order.status)) {
      throw new ApiError(
        422,
        `No se puede cancelar una orden en estado: ${order.status}`,
      );
    }

    // 4. Reembolso en Stripe — per-shipment para Connect, orden única para legacy
    log('INFO', 'Iniciando reembolso en Stripe', { orderId });

    // Fetch shipments with their PaymentIntent IDs (Connect-era) or fallback
    // to single order-level PI for legacy orders.
    const { data: orderShipments } = await supabaseAdmin
      .from('shipments')
      .select('id, stripe_payment_intent_id, status')
      .eq('order_id', orderId)
      .neq('status', 'cancelled');

    const shipmentsToRefund = (orderShipments ?? []).filter(
      (s) => s.stripe_payment_intent_id || order.stripe_payment_intent_id,
    );

    if (shipmentsToRefund.length === 0 && !order.stripe_payment_intent_id) {
      // No Connect PIs and no legacy PI — nothing to refund, just cancel in DB
      log('WARN', 'No Stripe payment to refund, cancelling in DB only', {
        orderId,
      });
    }

    let refundCount = 0;
    for (const shipment of shipmentsToRefund) {
      const piId =
        shipment.stripe_payment_intent_id ?? order.stripe_payment_intent_id;
      if (!piId) continue;

      try {
        const refundParams: Stripe.RefundCreateParams = {
          payment_intent: piId,
          reason: 'requested_by_customer',
          metadata: {
            order_id: orderId,
            shipment_id: shipment.id,
            cancelled_by: user.id,
            role,
          },
        };

        // Connect: reverse the transfer from seller's account
        if (shipment.stripe_payment_intent_id) {
          refundParams.reverse_transfer = true;
        }

        const refund = await stripe.refunds.create(refundParams, {
          idempotencyKey: `cancel_order_${shipment.id}`,
        });
        refundCount++;
        log('INFO', 'Refund processed', {
          shipmentId: shipment.id,
          refundId: refund.id,
        });
      } catch (stripeError: unknown) {
        const code =
          typeof stripeError === 'object' && stripeError !== null
            ? (stripeError as { code: string }).code
            : null;
        if (code === 'charge_already_refunded') {
          log('WARN', 'Charge already refunded', { shipmentId: shipment.id });
        } else {
          const msg =
            stripeError instanceof Error
              ? stripeError.message
              : String(stripeError);
          log('ERROR', 'Stripe refund failed', {
            shipmentId: shipment.id,
            error: msg,
          });
          throw new ApiError(500, `Error de Stripe: ${msg}`);
        }
      }
    }

    // If no shipments with PIs, try legacy single-order refund
    if (refundCount === 0 && order.stripe_payment_intent_id) {
      try {
        await stripe.refunds.create(
          {
            payment_intent: order.stripe_payment_intent_id,
            reason: 'requested_by_customer',
            metadata: { order_id: orderId, cancelled_by: user.id, role },
          },
          { idempotencyKey: `refund_v2_${orderId}` },
        );
        log('INFO', 'Legacy refund processed', { orderId });
      } catch (stripeError: unknown) {
        const code =
          typeof stripeError === 'object' && stripeError !== null
            ? (stripeError as { code: string }).code
            : null;
        if (code === 'charge_already_refunded') {
          log('WARN', 'Legacy charge already refunded', { orderId });
        } else {
          const msg =
            stripeError instanceof Error
              ? stripeError.message
              : String(stripeError);
          throw new ApiError(500, `Error de Stripe: ${msg}`);
        }
      }
    }

    // 5. Actualización Atómica en DB
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'fn_cancel_order',
      {
        p_order_id: orderId,
        p_reason: reason,
        p_cancelled_by_role: role,
      },
    );

    if (rpcError || !rpcData?.[0]?.success) {
      log('CRITICAL', 'REEMBOLSO EXITOSO PERO FALLO EN DB', {
        orderId,
        refundsProcessed: refundCount,
        dbError: rpcError?.message || rpcData?.[0]?.error_message,
      });
      throw new ApiError(
        500,
        'Dinero devuelto, pero error al actualizar inventario. Soporte técnico ha sido notificado.',
      );
    }

    log('INFO', 'Cancelación completada con éxito', {
      orderId,
      refunds: refundCount,
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Orden cancelada y dinero reembolsado',
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
