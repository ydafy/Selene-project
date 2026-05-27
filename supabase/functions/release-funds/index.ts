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
      function: 'release-funds',
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
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    log('INFO', 'Iniciando proceso de liberación de fondos (Cron/Manual)');

    // 1. Buscar órdenes 'delivered' con más de 48 horas
    const { data: orders, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id')
      .eq('status', 'delivered')
      .lt(
        'delivered_at',
        new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      )
      .limit(50);

    if (fetchError) throw fetchError;
    if (!orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No hay fondos para liberar' }),
        { status: 200 },
      );
    }

    let successCount = 0;

    for (const order of orders) {
      // Delegamos TODA la lógica a la RPC atómica
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
        'fn_release_order_funds',
        {
          p_order_id: order.id,
        },
      );

      if (rpcError || (rpcData && !rpcData[0]?.success)) {
        log('ERROR', `Fallo al liberar orden ${order.id}`, {
          error: rpcError?.message || rpcData?.[0]?.error_message,
        });
      } else {
        successCount++;
      }
    }

    log('INFO', 'Proceso finalizado', {
      total: orders.length,
      success: successCount,
    });

    return new Response(
      JSON.stringify({ processed: orders.length, success: successCount }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    log('ERROR', 'Fallo crítico en release-funds', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
});
