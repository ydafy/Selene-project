import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    log('INFO', 'Iniciando proceso de liberación de fondos');

    // 0. Evitar ejecución concurrente — lock en system_settings
    const { data: lock } = await supabaseAdmin
      .from('system_settings')
      .select('release_funds_running')
      .single();

    if (lock?.release_funds_running) {
      log('WARN', 'Otro proceso de release-funds está corriendo, saliendo');
      return new Response(JSON.stringify({ message: 'Already running' }), {
        status: 200,
      });
    }

    await supabaseAdmin
      .from('system_settings')
      .update({ release_funds_running: true })
      .eq('id', 1);

    // 1. Buscar envíos 'delivered' con más de 48 horas
    const { data: shipments, error: fetchError } = await supabaseAdmin
      .from('shipments')
      .select('id')
      .eq('status', 'delivered')
      .lt(
        'delivered_at',
        new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      )
      .limit(50);

    if (fetchError) throw fetchError;
    if (!shipments || shipments.length === 0) {
      // Liberar lock antes de salir
      await supabaseAdmin
        .from('system_settings')
        .update({ release_funds_running: false })
        .eq('id', 1);

      log('INFO', 'No hay fondos para liberar');
      return new Response(
        JSON.stringify({ message: 'No hay fondos para liberar' }),
        { status: 200 },
      );
    }

    let successCount = 0;

    for (const shipment of shipments) {
      // Delegamos TODA la lógica a la RPC atómica
      const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
        'fn_release_shipment_funds',
        {
          p_shipment_id: shipment.id,
        },
      );

      const success = rpcData?.[0]?.success ?? false;

      if (rpcError || !success) {
        const errorMsg = rpcError?.message || rpcData?.[0]?.error_message;

        // GRACE_PERIOD_ACTIVE means not ready yet, not an error
        if (errorMsg === 'GRACE_PERIOD_ACTIVE') {
          log('INFO', `Shipment ${shipment.id} still in grace period, skipping`, {
            shipmentId: shipment.id,
          });
        } else if (errorMsg === 'SHIPMENT_IN_ACTIVE_DISPUTE') {
          log('INFO', `Shipment ${shipment.id} has active dispute, skipping`, {
            shipmentId: shipment.id,
          });
        } else {
          log('CRITICAL', `Fallo al liberar envío ${shipment.id} — requiere revisión manual`, {
            shipmentId: shipment.id,
            error: errorMsg,
          });
        }
      } else {
        successCount++;
        log('INFO', 'Shipment completado exitosamente', {
          shipmentId: shipment.id,
        });
      }

      // Delay entre shipments para no saturar la DB
      await new Promise((r) => setTimeout(r, 300));
    }

    log('INFO', 'Proceso finalizado', {
      total: shipments.length,
      success: successCount,
    });

    // 2. Liberar lock
    await supabaseAdmin
      .from('system_settings')
      .update({ release_funds_running: false })
      .eq('id', 1);

    return new Response(
      JSON.stringify({ processed: shipments.length, success: successCount }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    // Liberar lock en caso de error crítico
    await supabaseAdmin
      .from('system_settings')
      .update({ release_funds_running: false })
      .eq('id', 1);

    log('ERROR', 'Fallo crítico en release-funds', { error: error.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
});