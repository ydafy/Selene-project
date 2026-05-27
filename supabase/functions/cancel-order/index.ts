import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import Stripe from 'https://esm.sh/stripe@17.0.0';
import { z } from 'https://esm.sh/zod@3.23.8';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

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
      apiVersion: '2025-12-15.clover',
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
    else if (order.items.some((item: any) => item.seller_id === user.id))
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

    if (!order.stripe_payment_intent_id) {
      throw new ApiError(
        422,
        'La orden no tiene un pago asociado para reembolsar',
      );
    }

    // 4. Reembolso en Stripe
    log('INFO', 'Iniciando reembolso en Stripe', {
      orderId,
      paymentIntent: order.stripe_payment_intent_id,
    });

    let refundId: string | null = null;
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: order.stripe_payment_intent_id,
          reason: 'requested_by_customer',
          metadata: { order_id: orderId, cancelled_by: user.id, role },
        },
        { idempotencyKey: `refund_v2_${orderId}` },
      );

      refundId = refund.id;
    } catch (stripeError: any) {
      // Si ya fue reembolsado, Stripe lanzará un error que debemos manejar
      if (stripeError.code === 'charge_already_refunded') {
        log('WARN', 'El cargo ya había sido reembolsado en Stripe', {
          orderId,
        });
      } else {
        log('ERROR', 'Fallo al crear reembolso en Stripe', {
          error: stripeError.message,
        });
        throw new ApiError(500, `Error de Stripe: ${stripeError.message}`);
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
        refundId,
        dbError: rpcError?.message || rpcData?.[0]?.error_message,
      });
      throw new ApiError(
        500,
        'Dinero devuelto, pero error al actualizar inventario. Soporte técnico ha sido notificado.',
      );
    }

    log('INFO', 'Cancelación completada con éxito', { orderId, refundId });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Orden cancelada y dinero reembolsado',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    const status = error instanceof ApiError ? error.status : 400;
    log('ERROR', 'Fallo en proceso de cancelación', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
