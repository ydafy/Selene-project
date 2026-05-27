import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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
      function: 'track-shipments',
      level,
      msg,
      ...data,
    }),
  );
};

const BATCH_SIZE = 50;

serve(async (req) => {
  if (req.method === 'OPTIONS')
    return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    log('INFO', 'Iniciando rastreo de paquetes');

    // 1. Obtener órdenes activas (priorizando las menos rastreadas recientemente)
    const { data: orders, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, tracking_number, status')
      .in('status', ['preparing', 'shipped'])
      .not('tracking_number', 'is', null)
      .order('last_tracked_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (fetchError) throw fetchError;
    if (!orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No hay órdenes para rastrear' }),
        { status: 200 },
      );
    }

    // 2. Configuración de API Envia
    const mode = Deno.env.get('ENVIA_MODE') || 'sandbox';
    const apiKey =
      mode === 'sandbox'
        ? Deno.env.get('ENVIA_API_KEY_SANDBOX')
        : Deno.env.get('ENVIA_API_KEY_PROD');
    const apiUrl =
      mode === 'sandbox'
        ? 'https://api-test.envia.com'
        : 'https://api.envia.com';

    const trackingNumbers = orders.map((o) => o.tracking_number);

    // 3. Consulta masiva a Envia.com
    const response = await fetch(`${apiUrl}/ship/generaltrack/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ trackingNumbers }),
    });

    const resData = await response.json();
    if (!response.ok || resData.meta === 'error') {
      throw new Error(`Envia API Error: ${resData.message || 'Unknown'}`);
    }

    let deliveredCount = 0;

    // 4. Procesar resultados
    for (const trackInfo of resData.data) {
      const order = orders.find(
        (o) => o.tracking_number === trackInfo.trackingNumber,
      );
      if (!order) continue;

      // Siempre actualizamos el timestamp de rastreo para el Cron
      await supabaseAdmin
        .from('orders')
        .update({ last_tracked_at: new Date().toISOString() })
        .eq('id', order.id);

      // Si el estado es entregado, disparamos la RPC atómica
      if (trackInfo.status?.toLowerCase() === 'delivered') {
        log('INFO', `Paquete entregado detectado`, { orderId: order.id });
        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
          'fn_mark_as_delivered',
          {
            p_order_id: order.id,
          },
        );

        if (rpcError || (rpcData && !rpcData[0]?.success)) {
          log('ERROR', `Fallo al ejecutar fn_mark_as_delivered`, {
            orderId: order.id,
            error: rpcError?.message || rpcData[0]?.error_message,
          });
        } else {
          deliveredCount++;
        }
      }
    }

    log('INFO', 'Rastreo finalizado', {
      total: orders.length,
      delivered: deliveredCount,
    });

    return new Response(
      JSON.stringify({ processed: orders.length, delivered: deliveredCount }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    log('ERROR', 'Fallo crítico en track-shipments', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
});
