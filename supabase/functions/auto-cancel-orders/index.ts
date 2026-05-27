import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const log = (
  level: 'INFO' | 'WARN' | 'ERROR',
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

serve(async (req) => {
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    log('INFO', 'Iniciando proceso de auto-cancelación');

    // 1. Obtener configuración
    const { data: settings } = await supabaseAdmin
      .from('system_settings')
      .select('order_expiration_hours')
      .single();

    const hours = settings?.order_expiration_hours || 48;
    const expirationLimit = new Date(
      Date.now() - hours * 60 * 60 * 1000,
    ).toISOString();

    // 2. Buscar órdenes expiradas que NO tengan tracking_number (Seguridad extra)
    const { data: expiredOrders, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('status', 'paid')
      .is('tracking_number', null) // Si ya tiene guía, no la cancelamos automáticamente
      .lt('created_at', expirationLimit)
      .limit(50);

    if (fetchError) throw fetchError;
    if (!expiredOrders || expiredOrders.length === 0) {
      log('INFO', 'No hay órdenes para cancelar');
      return new Response(JSON.stringify({ message: 'No orders to cancel' }), {
        status: 200,
      });
    }

    log('INFO', `Procesando ${expiredOrders.length} órdenes expiradas`);

    let successCount = 0;

    for (const order of expiredOrders) {
      try {
        // Reutilizamos la lógica blindada de cancel-order
        const { error: invokeError } = await supabaseAdmin.functions.invoke(
          'cancel-order',
          {
            body: {
              orderId: order.id,
              reason: `Cancelación automática: Excedió el límite de ${hours} horas para envío.`,
            },
          },
        );

        if (!invokeError) {
          successCount++;
        } else {
          log('ERROR', `Fallo al cancelar orden ${order.id}`, {
            error: invokeError,
          });
        }

        // Delay para no saturar Stripe API
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        log('ERROR', `Excepción en loop para orden ${order.id}`, {
          error: err.message,
        });
      }
    }

    log('INFO', 'Proceso finalizado', {
      total: expiredOrders.length,
      success: successCount,
    });

    return new Response(
      JSON.stringify({
        processed: expiredOrders.length,
        success: successCount,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    log('ERROR', 'Fallo crítico en auto-cancel-orders', {
      error: error.message,
    });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
});
