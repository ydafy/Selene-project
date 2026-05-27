import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
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

// Validación estricta del payload del Frontend
const RequestSchema = z.object({
  orderId: z.string().uuid('ID de orden inválido'),
  reason: z.string().min(1, 'La razón es obligatoria'),
  description: z.string().min(10, 'La descripción debe ser más detallada'),
  evidence: z.object({
    images: z
      .array(z.string().url('Las imágenes deben ser URLs válidas'))
      .min(1, 'Se requiere al menos una imagen de evidencia'),
    tech_checklist: z.record(z.boolean()),
    video_url: z.string().url().nullable().optional(),
  }),
});

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { orderId, reason, description, evidence } =
      RequestSchema.parse(body);

    log('INFO', 'Iniciando creación de disputa', { orderId, reason });

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
      .select('status, buyer_id, delivered_at, items:order_items(seller_id)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) throw new ApiError(404, 'Orden no encontrada');
    if (order.buyer_id !== user.id)
      throw new ApiError(403, 'No tienes permiso para disputar esta orden');

    // 3. Validar Estados Permitidos
    if (!['shipped', 'delivered'].includes(order.status)) {
      throw new ApiError(
        422,
        `No se puede abrir una disputa en estado: ${order.status}`,
      );
    }

    // 4. Validar Reloj de 48h (Solo si ya fue entregado)
    if (order.status === 'delivered' && order.delivered_at) {
      const deliveredTime = new Date(order.delivered_at).getTime();
      const currentTime = new Date().getTime();
      const fortyEightHours = 48 * 60 * 60 * 1000;

      if (currentTime - deliveredTime > fortyEightHours) {
        log('WARN', 'Intento de disputa fuera de tiempo', {
          orderId,
          deliveredAt: order.delivered_at,
        });
        throw new ApiError(
          422,
          'El plazo de 48 horas para reportar un problema ha expirado.',
        );
      }
    }

    const sellerId = order.items?.[0]?.seller_id;
    if (!sellerId)
      throw new ApiError(500, 'Error de integridad: Vendedor no encontrado');

    // 5. Insertar Disputa (Con manejo de Idempotencia)
    const { data: dispute, error: insertError } = await supabaseAdmin
      .from('disputes')
      .insert({
        order_id: orderId,
        buyer_id: user.id,
        seller_id: sellerId,
        reason,
        description,
        buyer_evidence: evidence,
        status: 'open',
      })
      .select('id')
      .single();

    if (insertError) {
      // 23505 es el código de Postgres para "Unique Violation"
      if (insertError.code === '23505') {
        log('WARN', 'Intento de disputa duplicada', { orderId });
        throw new ApiError(
          409,
          'Ya existe una disputa abierta para esta orden.',
        );
      }
      throw new ApiError(500, `Error al crear disputa: ${insertError.message}`);
    }

    // 6. Notificaciones
    const notifications = [
      {
        user_id: sellerId,
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
    });

    return new Response(
      JSON.stringify({ success: true, disputeId: dispute.id }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    const status = error instanceof ApiError ? error.status : 400;
    log('ERROR', 'Fallo al crear disputa', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
