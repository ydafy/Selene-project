import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
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

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2025-12-15.clover',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // 1. Validar Admin
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
    if (profile?.role !== 'admin')
      return new Response(
        JSON.stringify({
          error: 'Solo administradores pueden ejecutar reembolsos',
        }),
        { status: 403, headers: corsHeaders },
      );

    const { orderId, disputeId } = await req.json();

    // 2. Obtener Intent de Stripe
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('stripe_payment_intent_id, status')
      .eq('id', orderId)
      .single();
    if (orderError || !order) throw new Error('Orden no encontrada');

    // 3. Ejecutar Reembolso en Stripe
    log('INFO', 'Iniciando reembolso en Stripe', {
      orderId,
      intent: order.stripe_payment_intent_id,
    });

    try {
      await stripe.refunds.create(
        {
          payment_intent: order.stripe_payment_intent_id!,
          reason: 'requested_by_customer',
          metadata: { order_id: orderId, dispute_id: disputeId },
        },
        { idempotencyKey: `refund_dispute_${disputeId}` },
      );
    } catch (stripeError: any) {
      if (stripeError.code !== 'charge_already_refunded') throw stripeError;
    }

    // 4. Sincronizar con DB
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'fn_complete_dispute_refund',
      {
        p_order_id: orderId,
        p_dispute_id: disputeId,
      },
    );

    if (rpcError || (rpcData && !rpcData[0]?.success)) {
      log('ERROR', 'REEMBOLSO HECHO PERO FALLO DB', {
        error: rpcError?.message || rpcData?.[0]?.error_message,
      });
      throw new Error(
        'Dinero devuelto en Stripe, pero falló la actualización en Selene. Contacta a soporte.',
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error: any) {
    log('ERROR', 'Fallo en resolución de reembolso', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
