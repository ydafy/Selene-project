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
      function: 'return-delivery-timeout',
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
    log('INFO', 'Iniciando proceso de return-delivery-timeout');

    // 0. Evitar ejecución concurrente — lock en system_settings
    const { data: lock } = await supabaseAdmin
      .from('system_settings')
      .select('return_delivery_timeout_running')
      .single();

    if (lock?.return_delivery_timeout_running) {
      log('WARN', 'Otro proceso de return-delivery-timeout está corriendo, saliendo');
      return new Response(JSON.stringify({ message: 'Already running' }), {
        status: 200,
      });
    }

    await supabaseAdmin
      .from('system_settings')
      .update({ return_delivery_timeout_running: true })
      .eq('id', 1);

    // 1. Llamar a la SQL function atómica que procesa todo el batch
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'fn_cron_return_delivery_timeout',
    );

    if (rpcError) {
      log('ERROR', 'Fallo en fn_cron_return_delivery_timeout', {
        error: rpcError.message,
      });

      // Liberar lock en caso de error
      await supabaseAdmin
        .from('system_settings')
        .update({ return_delivery_timeout_running: false })
        .eq('id', 1);

      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 500,
      });
    }

    // 2. Liberar lock
    await supabaseAdmin
      .from('system_settings')
      .update({ return_delivery_timeout_running: false })
      .eq('id', 1);

    const result = rpcData?.[0] ?? rpcData;
    log('INFO', 'Proceso de return-delivery-timeout finalizado', {
      processed: result?.total_processed ?? 0,
      errors: result?.total_errors ?? 0,
    });

    return new Response(
      JSON.stringify({
        processed: result?.total_processed ?? 0,
        errors: result?.total_errors ?? 0,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error: any) {
    // Liberar lock en caso de error crítico
    await supabaseAdmin
      .from('system_settings')
      .update({ return_delivery_timeout_running: false })
      .eq('id', 1);

    log('ERROR', 'Fallo crítico en return-delivery-timeout', {
      error: error.message,
    });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
});