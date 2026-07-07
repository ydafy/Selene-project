import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import {
  ApiError,
  assertDisputeWindow,
  buildDisputeInsert,
  parseCreateDisputeRequestBody,
  validateShipmentDisputeContext,
} from './create-dispute.ts';

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
      function: 'create-dispute',
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
    const body = await req.json().catch(() => ({}));
    const { orderId, shipmentId, reason, description, evidence } =
      parseCreateDisputeRequestBody(body);

    log('INFO', 'Iniciando creación de disputa', {
      orderId,
      shipmentId,
      reason,
    });

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1. Autenticación
    const authHeader = req.headers.get('Authorization');
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(
      authHeader?.replace('Bearer ', '') || '',
    );
    if (authError || !user) throw new ApiError(401, 'No autorizado');

    // 2. Buscar Orden y Validar
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, status, buyer_id, delivered_at')
      .eq('id', orderId)
      .single();

    if (orderError || !order) throw new ApiError(404, 'Orden no encontrada');

    const { data: shipment, error: shipmentError } = await supabaseAdmin
      .from('shipments')
      .select('id, order_id, seller_id')
      .eq('id', shipmentId)
      .single();

    if (shipmentError || !shipment) {
      throw new ApiError(404, 'Envío no encontrado');
    }

    validateShipmentDisputeContext({
      userId: user.id,
      order,
      shipment,
    });

    // 3. Validar Estados Permitidos
    assertDisputeWindow(order);

    // 4. Validar Reloj de 48h (Solo si ya fue entregado)
    if (order.status === 'delivered' && order.delivered_at) {
      log('INFO', 'Validando ventana de disputa entregada', {
        orderId,
        deliveredAt: order.delivered_at,
      });
    }

    // 5. Insertar Disputa (Con manejo de Idempotencia)
    const { data: dispute, error: insertError } = await supabaseAdmin
      .from('disputes')
      .insert(
        buildDisputeInsert({
          order,
          shipment,
          buyerId: user.id,
          reason,
          description,
          evidence,
        }),
      )
      .select('id')
      .single();

    if (insertError) {
      // 23505 es el código de Postgres para "Unique Violation"
      if (insertError.code === '23505') {
        log('WARN', 'Intento de disputa duplicada', { orderId, shipmentId });
        throw new ApiError(
          409,
          'Ya existe una disputa abierta para este paquete.',
        );
      }
      throw new ApiError(500, `Error al crear disputa: ${insertError.message}`);
    }

    // 6. Notificaciones
    const notifications = [
      {
        user_id: shipment.seller_id,
        type: 'warning',
        title: 'Disputa Abierta',
        message: `El comprador reportó un problema con la orden #${orderId.slice(0, 8)}. Selene está revisando el caso.`,
        action_path: `/profile/orders/${orderId}`,
      },
      {
        user_id: user.id,
        type: 'info',
        title: 'Disputa Iniciada',
        message: `Tu reporte ha sido recibido. El equipo Selene revisará la evidencia.`,
        action_path: `/profile/orders/${orderId}`,
      },
    ];

    await supabaseAdmin.from('notifications').insert(notifications);

    log('INFO', 'Disputa creada exitosamente', {
      disputeId: dispute.id,
      orderId,
      shipmentId,
    });

    return new Response(
      JSON.stringify({ success: true, disputeId: dispute.id }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: unknown) {
    const status = error instanceof ApiError ? error.status : 400;
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'Fallo al crear disputa', { error: message });
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
