import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const log = (
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  msg: string,
  data?: Record<string, unknown>,
) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      function: 'resolve-dispute-refund',
      level,
      msg,
      ...data,
    }),
  );
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2026-04-22.dahlia',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 1. Autenticar usuario
    const authHeader = req.headers.get('Authorization');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(
      authHeader?.replace('Bearer ', '') || '',
    );
    if (authError || !user)
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401,
        headers: corsHeaders,
      });

    const { data: profile } = await supabaseAdmin
      .from('profiles_private')
      .select('role')
      .eq('id', user.id)
      .single();

    // 2. Validar input — solo disputeId
    const { disputeId } = await req.json();
    if (!disputeId)
      return new Response(JSON.stringify({ error: 'disputeId es requerido' }), {
        status: 422,
        headers: corsHeaders,
      });

    // 3. Leer dispute + order (determina seller, shipment, status, PI)
    const { data: dispute, error: disputeError } = await supabaseAdmin
      .from('disputes')
      .select(
        `
        seller_id,
        shipment_id,
        order_id,
        status,
        orders!inner(stripe_payment_intent_id)
      `,
      )
      .eq('id', disputeId)
      .single();

    if (disputeError || !dispute)
      return new Response(JSON.stringify({ error: 'Disputa no encontrada' }), {
        status: 404,
        headers: corsHeaders,
      });

    // 4. Auth: admin O seller de la disputa
    const isAdmin = profile?.role === 'admin';
    const isSeller = dispute.seller_id === user.id;
    if (!isAdmin && !isSeller)
      return new Response(
        JSON.stringify({
          error:
            'Solo administradores o el vendedor de la disputa pueden ejecutar reembolsos',
        }),
        { status: 403, headers: corsHeaders },
      );

    // 5. Validar status de la disputa
    const validStatuses = ['return_delivered', 'waiting_return'];
    if (!validStatuses.includes(dispute.status!))
      return new Response(
        JSON.stringify({
          error: `Estado inválido: ${dispute.status}. Debe ser return_delivered o waiting_return.`,
        }),
        { status: 422, headers: corsHeaders },
      );

    const stripeIntentId = (
      dispute.orders as unknown as { stripe_payment_intent_id: string }
    ).stripe_payment_intent_id;

    // =========================================================================
    // FIX CRÍTICO: Calcular monto exacto del shipment (en centavos)
    // Sin esto, Stripe reembolsa el 100% del PaymentIntent → en multi-seller
    // devuelve también el dinero de otros vendedores no disputados.
    // =========================================================================
    let refundAmountCents: number | null = null;

    if (dispute.shipment_id) {
      const { data: orderItems, error: itemsError } = await supabaseAdmin
        .from('order_items')
        .select('price_at_purchase, shipping_amount')
        .eq('shipment_id', dispute.shipment_id);

      if (itemsError || !orderItems || orderItems.length === 0) {
        log(
          'ERROR',
          'Error al consultar items para calcular reembolso parcial',
          {
            error: itemsError?.message,
          },
        );
        return new Response(
          JSON.stringify({
            error:
              'No se pudieron recuperar los artículos del envío para calcular el monto del reembolso.',
          }),
          { status: 500, headers: corsHeaders },
        );
      }

      const refundItems = orderItems as Array<{
        price_at_purchase: number;
        shipping_amount: number | null;
      }>;

      const totalRefundAmount = refundItems.reduce<number>(
        (sum, item) =>
          sum + item.price_at_purchase + (item.shipping_amount ?? 0),
        0,
      );

      refundAmountCents = Math.round(totalRefundAmount * 100);
      log('INFO', 'Monto de reembolso calculado', {
        shipmentId: dispute.shipment_id,
        totalRefundAmount,
        refundAmountCents,
      });
    }

    // 6. Resolve PI ID: Connect uses shipments.stripe_payment_intent_id,
    // Legacy uses orders.stripe_payment_intent_id (per T-001).
    // Also detect Connect for reverse_transfer + skip-wallet-rollback.
    let isConnectPayment = false;
    let connectStripeIntentId: string | null = null;
    if (dispute.shipment_id) {
      const { data: shipment } = await supabaseAdmin
        .from('shipments')
        .select('stripe_payment_intent_id')
        .eq('id', dispute.shipment_id)
        .maybeSingle();
      if (shipment?.stripe_payment_intent_id) {
        isConnectPayment = true;
        connectStripeIntentId = shipment.stripe_payment_intent_id;
      }
    }

    const finalStripeIntentId = isConnectPayment
      ? connectStripeIntentId!
      : stripeIntentId;

    // 7. Ejecutar Reembolso en Stripe (idempotente + monto parcial)
    log('INFO', 'Iniciando reembolso en Stripe', {
      disputeId,
      intent: finalStripeIntentId,
      amountCents: refundAmountCents,
    });

    try {
      const refundParams: Stripe.RefundCreateParams = {
        payment_intent: finalStripeIntentId,
        reason: 'requested_by_customer' as const,
        metadata: {
          dispute_id: disputeId,
          shipment_id: dispute.shipment_id ?? '',
        },
      };

      // Connect refund: reverse the transfer back from the seller's account
      if (isConnectPayment) {
        refundParams.reverse_transfer = true;
        log('INFO', 'Connect refund — reversing transfer', { disputeId });
      }

      if (refundAmountCents !== null) {
        refundParams.amount = refundAmountCents;
      }

      await stripe.refunds.create(refundParams, {
        idempotencyKey: `refund_dispute_${disputeId}`,
      });
    } catch (stripeError: unknown) {
      if (
        typeof stripeError === 'object' &&
        stripeError !== null &&
        'code' in stripeError &&
        (stripeError as { code: string }).code === 'charge_already_refunded'
      ) {
        log('INFO', 'Stripe refund idempotente — ya reembolsado', {
          disputeId,
        });
      } else {
        throw stripeError;
      }
    }

    // 7. Sincronizar DB — shipment-level si existe shipment_id
    let rpcSuccess = false;
    let rpcErrorMsg: string | null = null;

    if (isConnectPayment) {
      // Connect refund: reverse_transfer already handled by Stripe.
      // Do NOT call fn_complete_shipment_refund (it would double-write wallets).
      // Just update the shipment status directly.
      log(
        'INFO',
        'Connect refund — skipping wallet RPC, updating shipment directly',
        {
          disputeId,
          shipmentId: dispute.shipment_id,
        },
      );

      const { error: updateErr } = await supabaseAdmin
        .from('shipments')
        .update({ status: 'refunded' })
        .eq('id', dispute.shipment_id);
      if (updateErr) {
        rpcErrorMsg = updateErr.message;
        rpcSuccess = false;
      } else {
        rpcSuccess = true;
      }
    } else {
      // Legacy refund: wallet rollback needed
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
        'fn_complete_shipment_refund',
        { p_shipment_id: dispute.shipment_id },
      );

      if (rpcError) {
        rpcErrorMsg = rpcError.message;
      } else {
        rpcSuccess = rpcData?.[0]?.success ?? false;
        rpcErrorMsg = rpcData?.[0]?.error_message ?? null;
      }
    }

    if (!rpcSuccess) {
      log('CRITICAL', 'REEMBOLSO STRIPE HECHO PERO FALLO DB', {
        disputeId,
        error: rpcErrorMsg,
      });
      return new Response(
        JSON.stringify({
          error:
            'Dinero devuelto en Stripe, pero falló la actualización en Selene. Contacta a soporte.',
          dbError: rpcErrorMsg,
        }),
        { status: 500, headers: corsHeaders },
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Error desconocido';
    log('ERROR', 'Fallo en resolución de reembolso', { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
